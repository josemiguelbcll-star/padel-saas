// ============================================================================
// crear-club — Edge Function (onboarding de clubes desde el panel de
// plataforma — etapa 2).
//
// Crea de forma COORDINADA Y ATÓMICA un club nuevo + su primer admin:
//
//   1. Valida el body (club.nombre, club.plan_id, admin.nombre,
//      admin.email, admin.password).
//   2. Autentica al caller via su JWT.
//   3. Gate de superadmin: el caller debe estar en `plataforma_admins`
//      Y `activo=true`. Un admin de club NO puede crear clubes.
//   4. Valida que el plan exista y esté activo.
//   5. Genera un `slug` único server-side (slugify del nombre + retry
//      numérico si hay colisión).
//   6. INSERT en `clubes` (nombre, slug, plan_id, estado='trial',
//      campos legacy `plan='gratis'`/`activo=true` para satisfacer
//      NOT NULL, resto con defaults).
//   7. Crea usuario en `auth.users` con service_role.
//   8. INSERT en `usuarios` (rol='admin', club_id del club recién
//      creado).
//
// ROLLBACK EN CASCADA (atomicidad sin transacciones distribuidas):
//
//   - Si `createUser` falla → DELETE del club recién insertado.
//   - Si INSERT en `usuarios` falla → deleteUser(authUserId) +
//     DELETE del club.
//   - Si algún rollback falla, log + error claro al admin pidiendo
//     contactar soporte para limpieza manual. Best-effort.
//
// Códigos de respuesta:
//   200 — Club + admin creados. Body: { club: {...}, admin: {...} }.
//   400 — Body inválido / validaciones / plan inválido.
//   401 — Sin JWT o JWT inválido.
//   403 — Caller no es superadmin activo.
//   405 — Método distinto a POST/OPTIONS.
//   409 — Email del admin ya existe en auth.users.
//   500 — Error interno (INSERT falló, rollback fallido, env vars, etc.).
//
// Variables de entorno (auto-inyectadas por Supabase):
//   - SUPABASE_URL
//   - SUPABASE_ANON_KEY
//   - SUPABASE_SERVICE_ROLE_KEY
//
// IMPORTANTE — Verify JWT: la configuración de la función en el
// dashboard debe tener "Verify JWT" en OFF. La validación del JWT se
// hace internamente con parseJwtRole + getUser. Mismo patrón que
// crear-vendedor.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface CrearClubInputRaw {
  club?: {
    nombre?: unknown;
    plan_id?: unknown;
  } | null;
  admin?: {
    nombre?: unknown;
    email?: unknown;
    password?: unknown;
  } | null;
}

interface CrearClubOk {
  club: {
    id: number;
    nombre: string;
    slug: string;
    plan_id: number;
    estado: string;
  };
  admin: {
    id: string;
    email: string;
    nombre: string;
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/**
 * Parser de role del JWT sin validar firma — sólo para diagnóstico.
 * Mismo helper que crear-vendedor (duplicado porque Edge Functions
 * no comparten código sin packaging).
 */
function parseJwtRole(authHeader: string): string | null {
  try {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payloadB64 + '='.repeat((4 - (payloadB64.length % 4)) % 4);
    const payloadJson = atob(padded);
    const payload = JSON.parse(payloadJson);
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

/**
 * Convierte un nombre a slug URL-safe. Lowercase, sin acentos, sólo
 * alfanuméricos y guiones, max 50 chars. Si el resultado queda vacío
 * (nombre con sólo símbolos/emojis), retorna 'club' como base.
 */
function slugify(nombre: string): string {
  const s = nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return s.length > 0 ? s : 'club';
}

/**
 * Busca un slug único para el club. Intenta primero el slug base, si
 * existe prueba `-2`, `-3`, ..., `-100`. Si los 99 sufijos están
 * ocupados (imposible práctico), fallback con timestamp.
 */
async function findUniqueSlug(
  base: string,
  // deno-lint-ignore no-explicit-any
  adminClient: any,
): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const { data, error } = await adminClient
      .from('clubes')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle();
    if (error) {
      throw new Error(`No pudimos verificar el slug: ${error.message}`);
    }
    if (!data) return candidate;
  }
  // Fallback raro: 99 colisiones consecutivas. Timestamp garantiza unicidad.
  return `${base}-${Date.now()}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Método no permitido.' }, 405);
  }

  try {
    // 1. Env vars auto-inyectadas.
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      console.error('[crear-club] Faltan env vars de Supabase.');
      return json(
        { error: 'Configuración del servidor incompleta.' },
        500,
      );
    }

    // 2. Parse del body.
    let raw: CrearClubInputRaw;
    try {
      raw = await req.json();
    } catch {
      return json({ error: 'Body JSON inválido.' }, 400);
    }

    // 3. Validación de inputs.
    const clubNombre =
      typeof raw.club?.nombre === 'string' ? raw.club.nombre.trim() : '';
    const planId =
      typeof raw.club?.plan_id === 'number' &&
      Number.isInteger(raw.club.plan_id) &&
      raw.club.plan_id > 0
        ? raw.club.plan_id
        : null;
    const adminNombre =
      typeof raw.admin?.nombre === 'string' ? raw.admin.nombre.trim() : '';
    const adminEmail =
      typeof raw.admin?.email === 'string'
        ? raw.admin.email.trim().toLowerCase()
        : '';
    const adminPassword =
      typeof raw.admin?.password === 'string' ? raw.admin.password : '';

    if (clubNombre.length === 0 || clubNombre.length > 120) {
      return json(
        { error: 'El nombre del club es obligatorio (1-120 caracteres).' },
        400,
      );
    }
    if (planId === null) {
      return json({ error: 'plan_id inválido.' }, 400);
    }
    if (adminNombre.length === 0 || adminNombre.length > 120) {
      return json(
        { error: 'El nombre del administrador es obligatorio (1-120 caracteres).' },
        400,
      );
    }
    if (
      adminEmail.length < 5 ||
      adminEmail.length > 120 ||
      !adminEmail.includes('@')
    ) {
      return json({ error: 'Email del administrador inválido.' }, 400);
    }
    if (adminPassword.length < 8) {
      return json(
        { error: 'La contraseña debe tener al menos 8 caracteres.' },
        400,
      );
    }

    // 4. Auth del caller.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'No autenticado.' }, 401);
    }

    const tokenRole = parseJwtRole(authHeader);
    if (tokenRole === 'anon') {
      return json(
        {
          error:
            'Estás mandando el anon key, no el JWT de tu sesión. Necesitás llamar esta función con el access_token de un superadmin logueado.',
        },
        401,
      );
    }
    if (tokenRole === 'service_role') {
      return json(
        {
          error:
            'No usés el service_role para llamar esta función. Usá el JWT de un superadmin logueado.',
        },
        401,
      );
    }
    if (tokenRole === null) {
      return json(
        {
          error:
            'El header Authorization no es un JWT válido. Tiene que ser "Bearer <access_token>".',
        },
        401,
      );
    }

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const {
      data: { user: caller },
      error: authError,
    } = await callerClient.auth.getUser();
    if (authError || !caller) {
      console.error('[crear-club] getUser failed:', authError);
      return json(
        {
          error: `Sesión inválida o expirada${authError?.message ? `: ${authError.message}` : ''}.`,
        },
        401,
      );
    }

    // 5. GATE DE SUPERADMIN — la línea crítica.
    //    Consultamos plataforma_admins con el cliente del caller. La
    //    policy `plataforma_admins_select` (0019) requiere que el
    //    caller sea superadmin para leer la tabla → defensa en capas:
    //    si por algún motivo la policy no aplica, igual chequeamos
    //    activo abajo.
    const { data: callerProfile, error: profileError } = await callerClient
      .from('plataforma_admins')
      .select('id, activo')
      .eq('id', caller.id)
      .maybeSingle();

    if (profileError) {
      console.error('[crear-club] profileError:', profileError);
      return json({ error: 'No pudimos verificar tu perfil.' }, 500);
    }
    if (!callerProfile) {
      return json(
        { error: 'Solo el superadmin de la plataforma puede crear clubes.' },
        403,
      );
    }
    if ((callerProfile as { activo: boolean }).activo === false) {
      return json({ error: 'Tu usuario está desactivado.' }, 403);
    }

    // 6. Cliente service_role para todo lo que sigue (bypassa RLS).
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 7. Validar que el plan existe y está activo.
    const { data: plan, error: planError } = await adminClient
      .from('planes')
      .select('id, activo')
      .eq('id', planId)
      .maybeSingle();
    if (planError) {
      console.error('[crear-club] planError:', planError);
      return json({ error: 'No pudimos verificar el plan.' }, 500);
    }
    if (!plan || (plan as { activo: boolean }).activo === false) {
      return json({ error: 'Plan inválido o no activo.' }, 400);
    }

    // 8. Generar slug único.
    let slug: string;
    try {
      slug = await findUniqueSlug(slugify(clubNombre), adminClient);
    } catch (err) {
      console.error('[crear-club] slug error:', err);
      return json(
        { error: 'No pudimos generar el identificador del club.' },
        500,
      );
    }

    // 9. INSERT en clubes.
    //    Campos NOT NULL que se setean explícitamente:
    //      - nombre, slug, plan_id (form / generado / form).
    //      - estado='trial' (override del default 'activo' — club nuevo).
    //      - plan='gratis' (legacy NOT NULL desde 0001, no se usa post-0019).
    //      - activo=true (legacy NOT NULL desde 0001, no se usa post-0019).
    //    Resto: defaults (color_primario_hsl, config, duracion_turno_default,
    //    fecha_alta). hora_apertura/hora_cierre quedan NULL — el admin
    //    nuevo las setea en su onboarding wizard.
    const { data: clubInsert, error: clubError } = await adminClient
      .from('clubes')
      .insert({
        nombre: clubNombre,
        slug,
        plan_id: planId,
        estado: 'trial',
        plan: 'gratis',
        activo: true,
      })
      .select('id, nombre, slug, plan_id, estado')
      .single();

    if (clubError || !clubInsert) {
      console.error('[crear-club] club INSERT failed:', clubError);
      return json(
        { error: `No pudimos crear el club: ${clubError?.message ?? 'unknown'}` },
        500,
      );
    }

    const clubData = clubInsert as {
      id: number;
      nombre: string;
      slug: string;
      plan_id: number;
      estado: string;
    };

    // 10. createUser en auth.users.
    const { data: createdAuth, error: createError } =
      await adminClient.auth.admin.createUser({
        email: adminEmail,
        password: adminPassword,
        email_confirm: true,
      });

    if (createError || !createdAuth?.user) {
      // ROLLBACK 1: borrar el club recién creado.
      console.error(
        '[crear-club] createUser failed, iniciando rollback del club:',
        createError,
      );
      const { error: delClubError } = await adminClient
        .from('clubes')
        .delete()
        .eq('id', clubData.id);
      if (delClubError) {
        console.error(
          '[crear-club] Rollback del club FALLIDO — club huérfano sin admin:',
          { clubId: clubData.id, delClubError },
        );
        return json(
          {
            error:
              'Error al crear el admin Y rollback del club fallido. Contactá a soporte (club huérfano).',
          },
          500,
        );
      }

      // Detectar email duplicado para devolver 409.
      const msg = (createError?.message ?? '').toLowerCase();
      if (
        msg.includes('already') ||
        msg.includes('exist') ||
        msg.includes('registered') ||
        msg.includes('duplicate')
      ) {
        return json(
          { error: 'Ya existe un usuario con ese email.' },
          409,
        );
      }
      return json(
        {
          error:
            createError?.message ??
            'No pudimos crear el administrador en Auth.',
        },
        500,
      );
    }

    const newUserId = createdAuth.user.id;

    // 11. INSERT en usuarios con club_id del club recién creado.
    const { error: insertError } = await adminClient.from('usuarios').insert({
      id: newUserId,
      club_id: clubData.id,
      nombre: adminNombre,
      rol: 'admin',
      email: adminEmail,
      activo: true,
    });

    if (insertError) {
      // ROLLBACK 2 (en cascada): borrar auth user + club.
      console.error(
        '[crear-club] usuarios INSERT failed, iniciando rollback en cascada:',
        insertError,
      );
      let rollbackOk = true;

      const { error: delUserError } =
        await adminClient.auth.admin.deleteUser(newUserId);
      if (delUserError) {
        rollbackOk = false;
        console.error(
          '[crear-club] Rollback de auth.user FALLIDO:',
          { newUserId, delUserError },
        );
      }

      const { error: delClubError } = await adminClient
        .from('clubes')
        .delete()
        .eq('id', clubData.id);
      if (delClubError) {
        rollbackOk = false;
        console.error(
          '[crear-club] Rollback del club FALLIDO:',
          { clubId: clubData.id, delClubError },
        );
      }

      if (!rollbackOk) {
        return json(
          {
            error:
              'Error al crear el perfil del admin Y rollback fallido. Contactá a soporte para limpieza manual.',
          },
          500,
        );
      }
      return json(
        {
          error: `No pudimos crear el perfil del admin: ${insertError.message}`,
        },
        500,
      );
    }

    // 12. Éxito.
    const result: CrearClubOk = {
      club: {
        id: clubData.id,
        nombre: clubData.nombre,
        slug: clubData.slug,
        plan_id: clubData.plan_id,
        estado: clubData.estado,
      },
      admin: {
        id: newUserId,
        email: adminEmail,
        nombre: adminNombre,
      },
    };
    return json(result, 200);
  } catch (err) {
    console.error('[crear-club] Error inesperado:', err);
    return json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Error inesperado del servidor.',
      },
      500,
    );
  }
});
