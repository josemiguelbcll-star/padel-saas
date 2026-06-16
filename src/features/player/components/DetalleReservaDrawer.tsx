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

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl bg-white shadow-2xl overflow-y-auto p-6 max-h-[85vh] animate-slide-up">
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

        {/* Details Grid */}
        <div className="grid grid-cols-2 gap-4 mb-6">
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
          <div className="bg-slate-50 p-3 rounded-2xl">
            <span className="text-[10px] text-slate-400 font-semibold tracking-wider block mb-1">DURACIÓN</span>
            <span className="text-sm font-semibold text-slate-800">{r.duracion_min} minutos</span>
          </div>
          <div className="bg-slate-50 p-3 rounded-2xl">
            <span className="text-[10px] text-slate-400 font-semibold tracking-wider block mb-1">ID DE TURNO</span>
            <span className="text-sm font-mono text-slate-600">#{r.id}</span>
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

        {/* Action Button */}
        <button
          type="button"
          onClick={onClose}
          className="w-full bg-slate-950 text-white font-bold py-3 rounded-2xl transition hover:bg-slate-900 text-center"
        >
          Cerrar
        </button>
      </div>
    </>
  );
}
