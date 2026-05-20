import type { AuthError } from '@supabase/supabase-js';

/**
 * Traduce errores típicos de Supabase Auth a mensajes en castellano.
 *
 * Cubrimos cada caso con dos vías de detección (code + regex sobre
 * message) porque Supabase agregó `code` recién en versiones recientes
 * y algunos errores siguen llegando sólo con `message`.
 *
 * El mensaje crudo de Supabase NUNCA se muestra al usuario final: si no
 * matcheamos un caso conocido devolvemos un mensaje genérico.
 */
export function mapAuthError(error: AuthError): string {
  const code = error.code ?? '';
  const message = error.message ?? '';
  const status = error.status ?? 0;

  if (
    code === 'invalid_credentials' ||
    code === 'invalid_grant' ||
    /invalid login credentials/i.test(message)
  ) {
    return 'Email o contraseña incorrectos. Revisá los datos e intentá nuevamente.';
  }

  if (code === 'email_not_confirmed' || /email not confirmed/i.test(message)) {
    return 'Tu email todavía no fue confirmado. Revisá tu casilla (también la carpeta de spam) y hacé clic en el link de confirmación.';
  }

  if (
    status === 429 ||
    code === 'over_request_rate_limit' ||
    code === 'over_email_send_rate_limit' ||
    /too many|rate limit/i.test(message)
  ) {
    return 'Demasiados intentos seguidos. Esperá un minuto antes de volver a probar.';
  }

  if (code === 'user_not_found' || /user not found|no user found/i.test(message)) {
    return 'No encontramos una cuenta con ese email.';
  }

  if (code === 'user_banned' || /banned/i.test(message)) {
    return 'Tu cuenta está suspendida. Contactá al administrador del club.';
  }

  if (/network|failed to fetch|fetch failed/i.test(message)) {
    return 'Error de conexión. Verificá tu internet y volvé a intentar.';
  }

  return 'No pudimos iniciar sesión. Si el problema persiste, contactá al administrador.';
}
