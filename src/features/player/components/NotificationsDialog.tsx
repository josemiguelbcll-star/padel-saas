import { useState } from 'react';
import { Bell, CheckCheck, X, Calendar } from 'lucide-react';
import { useNotificaciones } from '../hooks/useNotificaciones';
import { cn } from '@/lib/utils';


export function NotificationsBell() {
  const { unreadCount, notificaciones, marcarLeida, marcarTodasLeidas } = useNotificaciones();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative flex h-10 w-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition active:scale-95"
        aria-label="Abrir notificaciones"
      >
        <Bell className="h-5 w-5 text-white" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-black text-white ring-2 ring-[#0B1F4D]">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          {/* Drawer Tray */}
          <div
            className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-3xl bg-slate-50 shadow-2xl transition-all duration-300 ease-out"
            style={{ maxHeight: '75dvh', paddingBottom: 'calc(env(safe-area-inset-bottom, 18px) + 20px)' }}
          >
            {/* Handler bar */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1.5 w-12 rounded-full bg-slate-300" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-white">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-extrabold text-slate-800">Notificaciones</h3>
                {unreadCount > 0 && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-600">
                    {unreadCount} nuevas
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={() => marcarTodasLeidas()}
                    className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 transition px-2 py-1.5 rounded-md hover:bg-slate-100"
                    title="Marcar todas como leídas"
                  >
                    <CheckCheck className="h-4 w-4" />
                    Leídas
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Notifications List */}
            <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
              {notificaciones.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-400 mb-4">
                    <Bell className="h-8 w-8" />
                  </div>
                  <p className="text-sm font-bold text-slate-700">¡Todo al día!</p>
                  <p className="text-xs text-slate-400 max-w-[240px] mt-1">
                    Acá vas a recibir los recordatorios de tus turnos fijos y notificaciones de tus partidos.
                  </p>
                </div>
              ) : (
                notificaciones.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => {
                      if (!n.leido) marcarLeida(n.id);
                    }}
                    className={cn(
                      "flex items-start gap-3 p-4 rounded-2xl border transition-all cursor-pointer",
                      n.leido
                        ? "bg-white border-slate-100 opacity-75"
                        : "bg-[#F3F4FD] border-indigo-100 hover:border-indigo-200 shadow-sm"
                    )}
                  >
                    {/* Status Dot */}
                    <div className="mt-1.5 flex shrink-0 items-center justify-center">
                      {!n.leido ? (
                        <span className="h-2.5 w-2.5 rounded-full bg-indigo-600 animate-pulse" />
                      ) : (
                        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className={cn("text-sm leading-tight truncate", !n.leido ? "font-extrabold text-slate-800" : "font-semibold text-slate-600")}>
                          {n.titulo}
                        </h4>
                        <span className="text-[10px] text-slate-400 whitespace-nowrap">
                          {new Date(n.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1 font-medium leading-relaxed">
                        {n.mensaje}
                      </p>
                      {n.tipo === 'recordatorio_turno' && (
                        <div className="mt-2 flex items-center gap-1.5 text-[10px] font-bold text-indigo-600">
                          <Calendar className="h-3 w-3" />
                          Ver detalle en Partidos
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
