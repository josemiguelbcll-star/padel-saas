import { createClient } from '@supabase/supabase-js';

// Vercel serverless function (Node.js runtime)
export default async function handler(req: any, res: any) {
  const { code, state, error: mpError } = req.query;

  // Si no hay state, no podemos saber a dónde redirigir. Fallback al home.
  if (!state) {
    return res.status(400).send('Falta el parámetro de estado (state)');
  }

  let clubId = '';
  let origin = '';

  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
    clubId = decoded.club_id;
    origin = decoded.origin;
  } catch (err) {
    console.error('[mercadopago-oauth] Error decodificando state:', err);
    return res.status(400).send('El estado (state) no es válido');
  }

  if (mpError || !code) {
    console.error('[mercadopago-oauth] Error en callback de Mercado Pago:', mpError);
    return res.redirect(`${origin}/app/configuracion/perfil-publico?mp_connection=error&error_reason=${encodeURIComponent(mpError || 'no_code')}`);
  }

  try {
    const clientId = process.env.MP_CLIENT_ID;
    const clientSecret = process.env.MP_CLIENT_SECRET;
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!clientId || !clientSecret || !supabaseUrl || !supabaseServiceKey) {
      console.error('[mercadopago-oauth] Falta configuración de entorno en el servidor');
      return res.redirect(`${origin}/app/configuracion/perfil-publico?mp_connection=error&error_reason=server_configuration_error`);
    }

    const protocol = req.headers.host.includes('localhost') ? 'http' : 'https';
    const redirectUri = `${protocol}://${req.headers.host}/api/mercadopago-oauth`;

    // Intercambiar el código por tokens en Mercado Pago
    const tokenResponse = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${clientSecret}`,
      },
      body: new URLSearchParams({
        client_secret: clientSecret,
        client_id: clientId,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[mercadopago-oauth] Error intercambiando token en Mercado Pago:', errorText);
      return res.redirect(`${origin}/app/configuracion/perfil-publico?mp_connection=error&error_reason=token_exchange_failed`);
    }

    const tokenData = await tokenResponse.json();
    const { access_token, public_key } = tokenData;

    if (!access_token) {
      console.error('[mercadopago-oauth] Respuesta de token sin access_token:', tokenData);
      return res.redirect(`${origin}/app/configuracion/perfil-publico?mp_connection=error&error_reason=invalid_token_response`);
    }

    // Inicializar cliente de Supabase con Service Role para saltar RLS
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Guardar credenciales en tabla privada
    const { error: upsertError } = await supabase
      .from('club_mercadopago_config')
      .upsert({
        club_id: Number(clubId),
        access_token: access_token,
        public_key: public_key || null,
      });

    if (upsertError) {
      console.error('[mercadopago-oauth] Error al guardar config en Supabase:', upsertError);
      return res.redirect(`${origin}/app/configuracion/perfil-publico?mp_connection=error&error_reason=db_save_failed`);
    }

    // 2. Traer config actual del club para no pisar otros campos
    const { data: clubData, error: clubFetchError } = await supabase
      .from('clubes')
      .select('config')
      .eq('id', Number(clubId))
      .single();

    if (clubFetchError) {
      console.error('[mercadopago-oauth] Error al buscar club en Supabase:', clubFetchError);
      return res.redirect(`${origin}/app/configuracion/perfil-publico?mp_connection=error&error_reason=club_fetch_failed`);
    }

    const newConfig = {
      ...(clubData?.config as any || {}),
      mercadopago: {
        conectado: true,
      },
    };

    // 3. Actualizar la config del club
    const { error: clubUpdateError } = await supabase
      .from('clubes')
      .update({ config: newConfig })
      .eq('id', Number(clubId));

    if (clubUpdateError) {
      console.error('[mercadopago-oauth] Error al actualizar config de club:', clubUpdateError);
      return res.redirect(`${origin}/app/configuracion/perfil-publico?mp_connection=error&error_reason=club_update_failed`);
    }

    // Éxito: Redirigir al perfil público
    return res.redirect(`${origin}/app/configuracion/perfil-publico?mp_connection=success`);
  } catch (error: any) {
    console.error('[mercadopago-oauth] Error inesperado:', error);
    return res.redirect(`${origin}/app/configuracion/perfil-publico?mp_connection=error&error_reason=unexpected_error`);
  }
}
