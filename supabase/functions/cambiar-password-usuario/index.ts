// ============================================================================
// cambiar-password-usuario — Edge Function
// Permite al superadmin de la plataforma cambiar o resetear la contraseña
// de cualquier usuario/admin de club vía Supabase Admin Auth API.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface CambiarPasswordInput {
  userId?: string;
  newPassword?: string;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Método no permitido.' }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      console.error('[cambiar-password-usuario] Faltan env vars de Supabase.');
      return json({ error: 'Configuración del servidor incompleta.' }, 500);
    }

    let body: CambiarPasswordInput;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Body JSON inválido.' }, 400);
    }

    const { userId, newPassword } = body;

    if (!userId || typeof userId !== 'string') {
      return json({ error: 'userId es obligatorio.' }, 400);
    }

    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
      return json({ error: 'La nueva contraseña debe tener al menos 6 caracteres.' }, 400);
    }

    // 1. Auth del caller
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'No autenticado.' }, 401);
    }

    const tokenRole = parseJwtRole(authHeader);
    if (tokenRole === 'anon' || tokenRole === null) {
      return json({ error: 'Token inválido o no provisto.' }, 401);
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
      return json({ error: 'Sesión inválida o expirada.' }, 401);
    }

    // 2. Gate de Superadmin
    const { data: callerProfile, error: profileError } = await callerClient
      .from('plataforma_admins')
      .select('id, activo')
      .eq('id', caller.id)
      .maybeSingle();

    if (profileError || !callerProfile) {
      return json({ error: 'Solo el superadmin de la plataforma puede cambiar contraseñas.' }, 403);
    }

    if ((callerProfile as { activo: boolean }).activo === false) {
      return json({ error: 'Tu usuario está desactivado.' }, 403);
    }

    // 3. Admin Client para actualizar la contraseña
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: updatedUser, error: updateError } = await adminClient.auth.admin.updateUserById(
      userId,
      { password: newPassword }
    );

    if (updateError || !updatedUser?.user) {
      console.error('[cambiar-password-usuario] Error al actualizar usuario:', updateError);
      return json({ error: updateError?.message ?? 'No pudimos actualizar la contraseña.' }, 500);
    }

    return json({
      ok: true,
      email: updatedUser.user.email,
      userId: updatedUser.user.id,
    }, 200);

  } catch (err) {
    console.error('[cambiar-password-usuario] Error inesperado:', err);
    return json(
      { error: err instanceof Error ? err.message : 'Error inesperado del servidor.' },
      500
    );
  }
});
