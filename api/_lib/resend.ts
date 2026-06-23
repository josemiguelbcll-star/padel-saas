import { createClient } from '@supabase/supabase-js';

// Interface matching the Supabase query response
interface ReservaConDetalle {
  id: number;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  duracion_min: number;
  monto_total: number;
  monto_sena: number;
  monto_pagado: number;
  estado: 'pendiente' | 'senada' | 'pagada' | 'jugada' | 'cancelada';
  observaciones: string | null;
  club: {
    id: number;
    nombre: string;
    direccion: string | null;
    telefono: string | null;
    email: string | null;
  } | null;
  cancha: {
    id: number;
    nombre: string;
  } | null;
  jugador: {
    id: number;
    nombre: string;
    email: string | null;
    telefono: string | null;
  } | null;
}

/**
 * Convierte una fecha YYYY-MM-DD en un formato amigable en español.
 */
function formatearFechaEspanol(fechaStr: string): string {
  try {
    const [year, month, day] = fechaStr.split('-').map(Number);
    // Usar Date UTC para evitar problemas de zona horaria local
    const fecha = new Date(Date.UTC(year, month - 1, day));
    return fecha.toLocaleDateString('es-AR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });
  } catch (e) {
    return fechaStr;
  }
}

/**
 * Limpia los segundos de un string de hora HH:MM:SS -> HH:MM.
 */
function formatearHora(horaStr: string): string {
  if (!horaStr) return '';
  const partes = horaStr.split(':');
  if (partes.length >= 2) {
    return `${partes[0]}:${partes[1]}`;
  }
  return horaStr;
}

/**
 * Genera el cuerpo de email HTML premium.
 */
function generarHtmlEmail(reserva: ReservaConDetalle): string {
  const clubNombre = reserva.club?.nombre || 'Club de Pádel';
  const jugadorNombre = reserva.jugador?.nombre || 'Jugador';
  const canchaNombre = reserva.cancha?.nombre || 'Cancha';
  const fechaAmigable = formatearFechaEspanol(reserva.fecha);
  const horaInicio = formatearHora(reserva.hora_inicio);
  const horaFin = formatearHora(reserva.hora_fin);
  
  // Formatear montos en pesos argentinos (o pesos genéricos)
  const formatMoneda = (valor: number) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(valor);
  };

  const montoTotalStr = formatMoneda(reserva.monto_total);
  const montoPagadoStr = formatMoneda(reserva.monto_pagado);
  const restanPagarStr = formatMoneda(Math.max(0, reserva.monto_total - reserva.monto_pagado));

  // Determinar color de badge de estado y texto descriptivo
  let badgeColor = '#eab308'; // pendiente / senada -> amarillo/naranja
  let estadoTexto = 'Pendiente de Pago';
  
  if (reserva.estado === 'senada') {
    badgeColor = '#3b82f6'; // azul
    estadoTexto = 'Señada (Pago Parcial)';
  } else if (reserva.estado === 'pagada') {
    badgeColor = '#10b981'; // verde
    estadoTexto = 'Totalmente Pagada';
  } else if (reserva.estado === 'cancelada') {
    badgeColor = '#ef4444'; // rojo
    estadoTexto = 'Cancelada';
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirmación de Reserva</title>
  <style>
    body {
      font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
      background-color: #f4f4f7;
      color: #333333;
      margin: 0;
      padding: 0;
      -webkit-text-size-adjust: none;
      width: 100% !important;
    }
    .wrapper {
      background-color: #f4f4f7;
      padding: 40px 10px;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    }
    .header {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      padding: 30px 40px;
      text-align: center;
      color: #ffffff;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }
    .content {
      padding: 40px;
    }
    .greeting {
      font-size: 18px;
      margin-bottom: 24px;
      font-weight: 500;
    }
    .card {
      background-color: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 30px;
    }
    .card-title {
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #64748b;
      margin-bottom: 16px;
      font-weight: 600;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 12px;
      font-size: 15px;
    }
    .detail-row:last-child {
      margin-bottom: 0;
    }
    .detail-label {
      color: #64748b;
    }
    .detail-value {
      font-weight: 600;
      color: #0f172a;
      text-align: right;
    }
    .status-badge {
      display: inline-block;
      padding: 6px 12px;
      border-radius: 9999px;
      color: #ffffff;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      background-color: ${badgeColor};
    }
    .divider {
      height: 1px;
      background-color: #e2e8f0;
      margin: 20px 0;
    }
    .payment-summary {
      background-color: #ecfdf5;
      border: 1px solid #a7f3d0;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 30px;
    }
    .payment-row {
      display: flex;
      justify-content: space-between;
      font-size: 14px;
      margin-bottom: 8px;
    }
    .payment-row.total {
      font-size: 16px;
      font-weight: 700;
      color: #065f46;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px dashed #a7f3d0;
      margin-bottom: 0;
    }
    .footer {
      background-color: #f8fafc;
      padding: 30px 40px;
      text-align: center;
      font-size: 13px;
      color: #64748b;
      border-top: 1px solid #e2e8f0;
    }
    .footer p {
      margin: 0 0 8px 0;
    }
    .footer p:last-child {
      margin-bottom: 0;
    }
    .footer a {
      color: #10b981;
      text-decoration: none;
      font-weight: 500;
    }
    .button-container {
      text-align: center;
      margin-top: 30px;
    }
    .button {
      background-color: #10b981;
      color: #ffffff !important;
      text-decoration: none;
      padding: 12px 24px;
      font-size: 15px;
      font-weight: 600;
      border-radius: 8px;
      display: inline-block;
      box-shadow: 0 2px 4px rgba(16, 185, 129, 0.2);
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <h1>${clubNombre}</h1>
      </div>
      <div class="content">
        <div class="greeting">¡Hola, ${jugadorNombre}!</div>
        <p style="font-size: 15px; line-height: 1.6; color: #475569; margin-bottom: 30px;">
          Te confirmamos que tu turno de pádel ha sido reservado correctamente. A continuación, te compartimos los detalles de la reserva:
        </p>
        
        <div class="card">
          <div class="card-title">Detalles del Turno</div>
          
          <div class="detail-row">
            <span class="detail-label">Cancha</span>
            <span class="detail-value">${canchaNombre}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Fecha</span>
            <span class="detail-value">${fechaAmigable}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Horario</span>
            <span class="detail-value">${horaInicio} a ${horaFin} hs (${reserva.duracion_min} min)</span>
          </div>
          <div class="detail-row" style="align-items: center; margin-top: 16px;">
            <span class="detail-label">Estado</span>
            <span class="detail-value">
              <span class="status-badge">${estadoTexto}</span>
            </span>
          </div>
        </div>

        <div class="payment-summary">
          <div class="card-title" style="color: #065f46; margin-bottom: 12px;">Resumen del Pago</div>
          <div class="payment-row">
            <span style="color: #047857;">Monto Total:</span>
            <span style="font-weight: 600; color: #065f46;">${montoTotalStr}</span>
          </div>
          <div class="payment-row">
            <span style="color: #047857;">Pagado:</span>
            <span style="font-weight: 600; color: #065f46;">${montoPagadoStr}</span>
          </div>
          <div class="payment-row total">
            <span>Resto a pagar en el club:</span>
            <span>${restanPagarStr}</span>
          </div>
        </div>

        ${reserva.observaciones ? `
        <div style="background-color: #f1f5f9; border-radius: 8px; padding: 16px; margin-bottom: 30px; font-size: 14px; color: #475569; border-left: 4px solid #94a3b8;">
          <strong>Notas/Observaciones:</strong><br>
          <span style="font-style: italic;">${reserva.observaciones}</span>
        </div>
        ` : ''}
        
        <p style="font-size: 14px; line-height: 1.5; color: #64748b; text-align: center; margin-top: 30px;">
          Por favor, recuerda llegar al menos 10 minutos antes del inicio del turno.<br>
          Si necesitas modificar o cancelar la reserva, ponte en contacto con el club.
        </p>
      </div>
      
      <div class="footer">
        <p style="font-weight: 600; color: #0f172a; margin-bottom: 4px;">${clubNombre}</p>
        ${reserva.club?.direccion ? `<p>${reserva.club.direccion}</p>` : ''}
        ${reserva.club?.telefono ? `<p>Tel: ${reserva.club.telefono}</p>` : ''}
        ${reserva.club?.email ? `<p>Email: <a href="mailto:${reserva.club.email}">${reserva.club.email}</a></p>` : ''}
        <div class="divider" style="margin: 15px 0;"></div>
        <p style="font-size: 11px; color: #94a3b8;">Mensaje enviado automáticamente por Canchaos.</p>
      </div>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Consulta la base de datos de Supabase para obtener los detalles de la reserva
 * y envía el email a través de la API de Resend.
 *
 * @param reservaId ID de la reserva a confirmar
 */
export async function sendBookingEmail(reservaId: number): Promise<{ success: boolean; message: string; emailId?: string }> {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.warn('[sendBookingEmail] RESEND_API_KEY no configurado en variables de entorno');
      return { success: false, message: 'RESEND_API_KEY no configurado' };
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('[sendBookingEmail] Faltan variables de conexión a Supabase');
      return { success: false, message: 'Configuración de Supabase incompleta' };
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Obtener la reserva y todos sus detalles
    const { data: rawData, error: dbError } = await supabase
      .from('reservas')
      .select(`
        id,
        fecha,
        hora_inicio,
        hora_fin,
        duracion_min,
        monto_total,
        monto_sena,
        monto_pagado,
        estado,
        observaciones,
        club:club_id(id, nombre, direccion, telefono, email),
        cancha:cancha_id(id, nombre),
        jugador:jugador_id(id, nombre, email, telefono)
      `)
      .eq('id', reservaId)
      .single();

    if (dbError || !rawData) {
      console.error('[sendBookingEmail] Error al obtener datos de reserva:', dbError);
      return { success: false, message: `Reserva no encontrada o error en DB: ${dbError?.message}` };
    }

    const reserva = rawData as unknown as ReservaConDetalle;

    // 2. Verificar que el jugador tenga email configurado
    const emailDestinatario = reserva.jugador?.email;
    if (!emailDestinatario || emailDestinatario.trim() === '') {
      console.info(`[sendBookingEmail] La reserva ${reservaId} no tiene un email de jugador registrado. Omitiendo envío.`);
      return { success: true, message: 'Jugador no tiene email configurado, no se envió correo.' };
    }

    // 3. Generar cuerpo HTML
    const htmlContent = generarHtmlEmail(reserva);

    // 4. Configurar remitente y asunto
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
    const clubNombre = reserva.club?.nombre || 'Club de Pádel';
    const sender = `${clubNombre} <${fromEmail}>`;
    const subject = `Confirmación de Reserva: ${reserva.cancha?.nombre || 'Cancha'} - ${formatearFechaEspanol(reserva.fecha)}`;

    // 5. Enviar a través de la API de Resend
    console.info(`[sendBookingEmail] Enviando correo a ${emailDestinatario} para la reserva ${reservaId}...`);
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: sender,
        to: [emailDestinatario],
        subject: subject,
        html: htmlContent,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[sendBookingEmail] Error en la respuesta de la API de Resend:', errorText);
      return { success: false, message: `Error en API de Resend: ${errorText}` };
    }

    const resData = await response.json() as { id: string };
    console.info(`[sendBookingEmail] Email enviado con éxito. ID: ${resData.id}`);
    return { success: true, message: 'Email enviado con éxito', emailId: resData.id };
  } catch (error: any) {
    console.error('[sendBookingEmail] Error inesperado en el proceso de envío:', error);
    return { success: false, message: error.message || 'Error inesperado' };
  }
}
