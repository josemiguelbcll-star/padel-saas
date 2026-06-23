import { sendBookingEmail } from './_lib/resend';

// Vercel serverless function (Node.js runtime)
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

  const { reserva_id } = req.body;

  if (!reserva_id) {
    return res.status(400).json({ error: 'Falta el parámetro requerido: reserva_id' });
  }

  try {
    const result = await sendBookingEmail(Number(reserva_id));
    
    if (!result.success) {
      return res.status(500).json({
        error: 'Error al enviar el email de reserva',
        message: result.message,
      });
    }

    return res.status(200).json({
      success: true,
      message: result.message,
      emailId: result.emailId,
    });
  } catch (error: any) {
    console.error('[send-booking-email] Error inesperado:', error);
    return res.status(500).json({ error: error.message || 'Error inesperado del servidor' });
  }
}
