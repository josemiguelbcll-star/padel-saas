import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { useJugadorAmigos } from '../hooks/useJugadorAmigos';
import { useReservasInvitaciones } from '../hooks/useReservasInvitaciones';
import { type MiReservaReal, formatFechaReserva, formatHoraReserva, labelEstado, colorEstado } from '../hooks/useMyReservas';

interface DetalleReservaDrawerProps {
  r: MiReservaReal;
  onClose: () => void;
}

export function DetalleReservaDrawer({ r, onClose }: DetalleReservaDrawerProps) {
  const c = colorEstado(r.estado);
  const total = r.monto_total;
  const pagado = r.monto_pagado;
  const saldo = total - pagado;
  const { amigosConfirmados } = useJugadorAmigos();
  const { invitaciones, invitarAmigo, isLoading: invitacionesLoading } = useReservasInvitaciones(r.id);
  const [amigoSeleccionadoId, setAmigoSeleccionadoId] = useState('');
  const [enviandoInvitacion, setEnviandoInvitacion] = useState(false);
  const [errorInvitacion, setErrorInvitacion] = useState<string | null>(null);
  const puedeInvitar = r.club_confirmada_en !== null || r.mp_estado === 'confirmada';
  const amigosDisponibles = amigosConfirmados.filter(
    (amigo) => !invitaciones.some((invitacion) => invitacion.invitado_jugador_app_id === amigo.id),
  );

  async function handleInvitarAmigo() {
    const amigo = amigosConfirmados.find((actual) => actual.id === amigoSeleccionadoId);
    if (!amigo) return;
    setErrorInvitacion(null);
    setEnviandoInvitacion(true);
    try {
      await invitarAmigo(amigo, {
        id: r.id,
        club_id: r.club_id,
        club_nombre: r.club_nombre,
        cancha_nombre: r.cancha_nombre,
        fecha: r.fecha,
        hora_inicio: r.hora_inicio,
      }, 'Un amigo');
      setAmigoSeleccionadoId('');
    } catch (error) {
      setErrorInvitacion(error instanceof Error ? error.message : 'No se pudo enviar la invitación.');
    } finally {
      setEnviandoInvitacion(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[140] bg-black/50 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-x-0 bottom-0 z-[150] rounded-t-3xl bg-white shadow-2xl overflow-y-auto p-6 pb-10 max-h-[85vh] animate-slide-up">
        {/* Drag handle decoration */}
        <div className="mx-auto w-12 h-1.5 bg-slate-200 rounded-full mb-5" />

        {/* Title */}
        <div className="mb-6">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-xl font-bold text-slate-950 leading-tight">{r.club_nombre}</h2>
              <p className="text-sm text-slate-500 mt-1">{r.cancha_nombre}</p>
            </div>
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              color: c.text,
              background: c.bg,
              border: `1px solid ${c.border}`,
              borderRadius: 20,
              padding: '4px 12px',
            }}>
              {labelEstado(r.estado)}
            </span>
          </div>
        </div>

        {r.mp_estado && (
          <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            {r.mp_estado === 'pre_reserva' && (
              <>Pre-reserva pendiente de pago. Vence {r.mp_expira_en ? new Date(r.mp_expira_en).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : 'en 10 minutos'}.</>
            )}
            {r.mp_estado === 'pago_acreditado' && 'Seña acreditada. El club debe confirmar el turno.'}
            {r.mp_estado === 'pago_tardio' && 'El pago llegó fuera del plazo. El club debe revisar cómo resolver la reserva.'}
            {r.mp_estado === 'confirmada' && 'El club confirmó tu turno.'}
            {r.mp_estado === 'expirada' && 'La pre-reserva venció y el horario fue liberado.'}
          </div>
        )}

        {/* Details Grid */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="bg-slate-50 p-3 rounded-2xl">
            <span className="text-[10px] text-slate-400 font-semibold tracking-wider block mb-1">FECHA</span>
            <span className="text-sm font-semibold text-slate-800">{formatFechaReserva(r.fecha)}</span>
          </div>
          <div className="bg-slate-50 p-3 rounded-2xl">
            <span className="text-[10px] text-slate-400 font-semibold tracking-wider block mb-1">HORARIO</span>
            <span className="text-sm font-semibold text-slate-800">
              {formatHoraReserva(r.hora_inicio)} - {formatHoraReserva(r.hora_fin)}
            </span>
          </div>
          <div className="bg-slate-50 p-3 rounded-2xl col-span-2">
            <span className="text-[10px] text-slate-400 font-semibold tracking-wider block mb-1">DURACIÓN</span>
            <span className="text-sm font-semibold text-slate-800">{r.duracion_min} minutos</span>
          </div>
        </div>

        {/* Financial Info */}
        <div className="border border-slate-100 rounded-2xl p-4 mb-6">
          <div className="flex justify-between items-center py-1.5">
            <span className="text-sm text-slate-500">Valor total</span>
            <span className="text-sm font-semibold text-slate-800">${total.toLocaleString('es-AR')}</span>
          </div>
          <div className="flex justify-between items-center py-1.5 border-t border-slate-50">
            <span className="text-sm text-slate-500">Monto abonado</span>
            <span className="text-sm font-semibold text-emerald-600">${pagado.toLocaleString('es-AR')}</span>
          </div>
          {saldo > 0 && (
            <div className="flex justify-between items-center py-2 border-t border-slate-100 mt-1">
              <span className="text-sm font-medium text-slate-700">Saldo pendiente</span>
              <span className="text-base font-bold text-amber-600">${saldo.toLocaleString('es-AR')}</span>
            </div>
          )}
        </div>

        {puedeInvitar && (
          <div className="mb-6 space-y-3 rounded-2xl border border-slate-200 p-4">
            <div className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-slate-600" />
              <h3 className="text-sm font-bold text-slate-800">Invitar amigos</h3>
            </div>
            {amigosDisponibles.length > 0 ? (
              <div className="flex gap-2">
                <select
                  value={amigoSeleccionadoId}
                  onChange={(event) => setAmigoSeleccionadoId(event.target.value)}
                  disabled={invitacionesLoading || enviandoInvitacion}
                  className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800"
                  aria-label="Elegir amigo para invitar"
                >
                  <option value="">Elegir amigo…</option>
                  {amigosDisponibles.map((amigo) => (
                    <option key={amigo.id} value={amigo.id}>
                      {amigo.alias ? `@${amigo.alias}` : amigo.nombre_display}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void handleInvitarAmigo()}
                  disabled={!amigoSeleccionadoId || enviandoInvitacion}
                  className="shrink-0 rounded-xl bg-[#0B1F4D] px-4 text-sm font-bold text-white disabled:opacity-50"
                >
                  {enviandoInvitacion ? 'Enviando…' : 'Invitar'}
                </button>
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                {amigosConfirmados.length === 0
                  ? 'Agregá amigos en MatchGo para poder invitarlos.'
                  : 'Ya invitaste a todos tus amigos confirmados.'}
              </p>
            )}
            {errorInvitacion && <p role="alert" className="text-xs text-red-600">{errorInvitacion}</p>}
            {invitaciones.length > 0 && (
              <ul className="space-y-1 border-t border-slate-100 pt-2">
                {invitaciones.map((invitacion) => {
                  const amigo = amigosConfirmados.find((actual) => actual.id === invitacion.invitado_jugador_app_id);
                  return (
                    <li key={invitacion.id} className="flex justify-between gap-2 text-xs text-slate-600">
                      <span className="truncate">{amigo?.nombre_display ?? 'Amigo invitado'}</span>
                      <span className="shrink-0 font-semibold">
                        {invitacion.estado === 'aceptada' ? 'Aceptó' : invitacion.estado === 'rechazada' ? 'No puede' : 'Pendiente'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col gap-2.5">
          <a
            href={`https://wa.me/?text=${encodeURIComponent(
              `🎾 *¡Tenemos partido de pádel en MatchGo!*\n\n` +
              `📍 Club: *${r.club_nombre}*\n` +
              `🏟️ Cancha: ${r.cancha_nombre}\n` +
              `📅 Fecha: ${formatFechaReserva(r.fecha)}\n` +
              `⏰ Horario: ${formatHoraReserva(r.hora_inicio)} - ${formatHoraReserva(r.hora_fin)}\n` +
              `💵 Total: $${total.toLocaleString('es-AR')}${saldo > 0 ? ` (Saldo: $${saldo.toLocaleString('es-AR')})` : ' (Abonado)'}\n\n` +
              `¡Prepará la paleta!`
            )}`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold py-3 rounded-2xl transition text-center flex items-center justify-center gap-2 shadow-sm"
          >
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
            </svg>
            Compartir turno por WhatsApp
          </a>

          <button
            type="button"
            onClick={onClose}
            className="w-full bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold py-3 rounded-2xl transition text-center"
          >
            Cerrar
          </button>
        </div>
      </div>
    </>
  );
}
