import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

// Claves VAPID por defecto (las generadas para desarrollo)
const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BPcUEWDTGeJFQ71eF9sLj6YIsGepeXsuRnsV21A_pTms45IxDufteq7fXV2-VFODCAU0_E805X508sHSNlRxtNQ';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'IvMoqc7uhPJtfIigtO_RQsSjCRDFvoquzvBNS-7FcnE';
const MAILTO = process.env.VAPID_MAILTO || 'mailto:soporte@matchgo.com';

// Configurar detalles VAPID de forma global
webpush.setVapidDetails(MAILTO, PUBLIC_KEY, PRIVATE_KEY);

export default async function handler(req: any, res: any) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { user_id, title, body, url, data } = req.body;

  if (!user_id || !title || !body) {
    return res.status(400).json({ error: 'Faltan parámetros obligatorios: user_id, title, body' });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[send-pwa-push] Faltan variables de conexión a Supabase (SERVICE_ROLE)');
    return res.status(500).json({ error: 'Configuración del servidor incompleta' });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // 1. Obtener todas las suscripciones activas de este usuario
    const { data: subscriptions, error: dbError } = await supabase
      .from('user_pwa_subscriptions')
      .select('endpoint, keys_auth, keys_p256dh')
      .eq('user_id', user_id);

    if (dbError) {
      console.error('[send-pwa-push] Error al consultar suscripciones:', dbError);
      return res.status(500).json({ error: 'Error al consultar suscripciones de la base de datos' });
    }

    if (!subscriptions || subscriptions.length === 0) {
      return res.status(200).json({ success: true, message: 'El usuario no tiene suscripciones PWA activas' });
    }

    const payload = JSON.stringify({
      title,
      body,
      url: url || '/player',
      data: data || {}
    });

    const sendPromises = subscriptions.map(async (sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          auth: sub.keys_auth,
          p256dh: sub.keys_p256dh
        }
      };

      try {
        await webpush.sendNotification(pushSubscription, payload);
        return { endpoint: sub.endpoint, success: true };
      } catch (err: any) {
        // 410 Gone o 404 Not Found significan que la suscripción expiró o fue eliminada por el navegador
        if (err.statusCode === 410 || err.statusCode === 404) {
          console.info(`[send-pwa-push] Suscripción expirada en endpoint: ${sub.endpoint}. Eliminando de la BD.`);
          await supabase
            .from('user_pwa_subscriptions')
            .delete()
            .eq('endpoint', sub.endpoint);
        } else {
          console.error(`[send-pwa-push] Error enviando a endpoint ${sub.endpoint}:`, err.message || err);
        }
        return { endpoint: sub.endpoint, success: false, error: err.message || err };
      }
    });

    const results = await Promise.all(sendPromises);
    const successfulSends = results.filter(r => r.success).length;

    return res.status(200).json({
      success: true,
      total_subscriptions: subscriptions.length,
      sent_successfully: successfulSends,
      details: results
    });

  } catch (error: any) {
    console.error('[send-pwa-push] Error crítico inesperado:', error);
    return res.status(500).json({ error: error.message || 'Error inesperado del servidor' });
  }
}
