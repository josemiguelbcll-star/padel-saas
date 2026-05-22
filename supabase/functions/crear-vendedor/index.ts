// ============================================================================
// crear-vendedor — Edge Function (módulo de gestión de usuarios, bloque 2).
//
// Crea un usuario nuevo (admin o vendedor) en el club del admin que llama:
//
//   1. Valida el body (email, password, nombre, rol).
//   2. Autentica al caller via su JWT (header Authorization).
//   3. Verifica que el caller sea admin Y esté activo.
//   4. DERIVA el club_id del caller. NUNCA del input — invariante de
//      seguridad multi-tenant: un admin sólo puede crear usuarios en
//      SU club.
//   5. Crea el usuario en auth.users con service_role.
//   6. INSERTA la fila en `usuarios` con el club_id del caller.
//   7. Si el INSERT falla, ROLLBACK: borra el usuario recién creado en
//      Auth para no dejar huérfano (que rompería SessionProvider con
//      NO_USUARIO_ROW). Best-effort — si el rollback también falla,
//      error claro para que el admin escale a soporte.
//
// Códigos de respuesta:
//   200 — Usuario creado. Body: { id, email, nombre, rol }
//   400 — Body inválido / validaciones de formato.
//   401 — Sin JWT o JWT inválido.
//   403 — Caller no es admin, no está activo, o no tiene perfil.
//   405 — Método distinto a POST/OPTIONS.
//   409 — Email ya existe en auth.users.
//   500 — Error interno (env vars, DB, rollback fallido, etc.).
//
// Variables de entorno (auto-inyectadas por Supabase en TODAS las Edge
// Functions — no hace falta configurarlas):
//   - SUPABASE_URL
//   - SUPABASE_ANON_KEY
//   - SUPABASE_SERVICE_ROLE_KEY
//
// CORS: 'Access-Control-Allow-Origin: *' para etapa actual. Para
// producción se puede restringir al dominio del SaaS.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface CrearVendedorInputRaw {
  email?: unknown;
  password?: unknown;
  nombre?: unknown;
  rol?: unknown;
}

interface CrearVendedorOk {
  id: string;
  email: string;
  nombre: string;
  rol: 'admin' | 'vendedor';
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/**
 * Parsea el `role` del JWT del header Authorization sin validar la
 * firma — sólo para diagnóstico. Retorna 'anon' | 'authenticated' |
 * 'service_role' | null. Usado para devolver un mensaje accionable
 * cuando el caller manda el anon key por error (caso típico al
 * probar desde el panel del dashboard, que autocompleta el anon).
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

Deno.serve(async (req: Request) => {
  // CORS preflight.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Método no permitido.' }, 405);
  }

  try {
    // 1. Env vars auto-inyectadas. Si faltan, falla de configuración.
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      console.error('[crear-vendedor] Faltan env vars de Supabase.');
      return json(
        { error: 'Configuración del servidor incompleta.' },
        500,
      );
    }

    // 2. Parse del body.
    let raw: CrearVendedorInputRaw;
    try {
      raw = await req.json();
    } catch {
      return json({ error: 'Body JSON inválido.' }, 400);
    }

    // 3. Validación de inputs.
    const email =
      typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : '';
    const password = typeof raw.password === 'string' ? raw.password : '';
    const nombre =
      typeof raw.nombre === 'string' ? raw.nombre.trim() : '';
    const rol = raw.rol;

    if (email.length < 5 || email.length > 120 || !email.includes('@')) {
      return json({ error: 'Email inválido.' }, 400);
    }
    if (password.length < 8) {
      return json(
        { error: 'La contraseña debe tener al menos 8 caracteres.' },
        400,
      );
    }
    if (nombre.length === 0 || nombre.length > 120) {
      return json(
        { error: 'El nombre es obligatorio (1-120 caracteres).' },
        400,
      );
    }
    if (rol !== 'admin' && rol !== 'vendedor') {
      return json(
        { error: 'Rol inválido. Debe ser admin o vendedor.' },
        400,
      );
    }

    // 4. Auth del caller via su JWT.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'No autenticado.' }, 401);
    }

    // Diagnóstico previo: si el caller mandó el anon key o el
    // service_role, devolvemos un mensaje accionable en vez de un
    // genérico "Sesión inválida". Caso típico: el panel "Test" del
    // dashboard de Supabase autocompleta el header Authorization con
    // el anon key, no con el JWT del usuario logueado.
    const tokenRole = parseJwtRole(authHeader);
    if (tokenRole === 'anon') {
      return json(
        {
          error:
            'Estás mandando el anon key, no el JWT de tu sesión. Necesitás llamar esta función con el access_token de un usuario admin logueado en la app (no la API key pública del proyecto).',
        },
        401,
      );
    }
    if (tokenRole === 'service_role') {
      return json(
        {
          error:
            'No usés el service_role para llamar esta función. Usá el JWT (access_token) de un usuario admin logueado.',
        },
        401,
      );
    }
    if (tokenRole === null) {
      return json(
        {
          error:
            'El header Authorization no es un JWT válido. Tiene que ser "Bearer <access_token>" — con un JWT de 3 partes separadas por puntos.',
        },
        401,
      );
    }

    // Cliente con el JWT del caller — respeta RLS. Lo usamos sólo
    // para verificar identidad y leer el perfil del caller.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const {
      data: { user: caller },
      error: authError,
    } = await callerClient.auth.getUser();
    if (authError || !caller) {
      console.error('[crear-vendedor] getUser failed:', authError);
      return json(
        {
          error: `Sesión inválida o expirada${authError?.message ? `: ${authError.message}` : ''}.`,
        },
        401,
      );
    }

    // 5. Verificar admin + activo + DERIVAR club_id del caller.
    //    NUNCA tomamos el club_id del input — invariante de seguridad.
    const { data: callerProfile, error: profileError } = await callerClient
      .from('usuarios')
      .select('club_id, rol, activo')
      .eq('id', caller.id)
      .maybeSingle();

    if (profileError) {
      console.error('[crear-vendedor] profileError:', profileError);
      return json({ error: 'No pudimos verificar tu perfil.' }, 500);
    }
    if (!callerProfile) {
      return json(
        { error: 'No tenés un perfil de usuario asociado a un club.' },
        403,
      );
    }
    if (callerProfile.activo === false) {
      return json({ error: 'Tu usuario está desactivado.' }, 403);
    }
    if (callerProfile.rol !== 'admin') {
      return json(
        { error: 'Solo el admin del club puede crear usuarios.' },
        403,
      );
    }

    const clubId: number = callerProfile.club_id;

    // 6. Cliente service_role para crear en auth.users. Sólo en este
    //    contexto (Edge Function) accedemos al service_role — NUNCA
    //    en el frontend.
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 7. Crear en auth.users. email_confirm: true para que el usuario
    //    pueda loguearse directo sin esperar email de confirmación
    //    (Supabase no manda email salvo que esté SMTP configurado).
    const { data: createdAuth, error: createError } =
      await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

    if (createError || !createdAuth?.user) {
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
      console.error('[crear-vendedor] createUser failed:', createError);
      return json(
        {
          error:
            createError?.message ??
            'No pudimos crear el usuario en Auth.',
        },
        500,
      );
    }

    const newUserId = createdAuth.user.id;

    // 8. INSERT en `usuarios` con el club_id del caller. Usamos
    //    adminClient porque NO hay policy INSERT para `authenticated`
    //    en `usuarios` (los altas vienen siempre por acá — 0001 fue
    //    explícito).
    const { error: insertError } = await adminClient.from('usuarios').insert({
      id: newUserId,
      club_id: clubId,
      nombre,
      rol,
      email,
      activo: true,
    });

    if (insertError) {
      // ROLLBACK: borrar el usuario recién creado en Auth. Si NO
      // hacemos rollback, queda un auth.users sin fila en `usuarios`
      // → al loguearse rompe SessionProvider con NO_USUARIO_ROW.
      console.error(
        '[crear-vendedor] INSERT en usuarios falló, intentando rollback:',
        insertError,
      );
      const { error: deleteError } =
        await adminClient.auth.admin.deleteUser(newUserId);
      if (deleteError) {
        console.error(
          '[crear-vendedor] Rollback FALLIDO — usuario huérfano en auth.users:',
          { newUserId, deleteError },
        );
        return json(
          {
            error:
              'Error al crear el usuario y rollback fallido. Contactá a soporte para limpieza manual.',
          },
          500,
        );
      }
      return json(
        {
          error: `No pudimos crear el perfil del usuario: ${insertError.message}`,
        },
        500,
      );
    }

    // 9. Éxito.
    const result: CrearVendedorOk = { id: newUserId, email, nombre, rol };
    return json(result, 200);
  } catch (err) {
    console.error('[crear-vendedor] Error inesperado:', err);
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
