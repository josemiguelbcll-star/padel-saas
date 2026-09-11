import { useState, useMemo } from 'react';
import {
  Bell,
  CheckCheck,
  X,
  Calendar,
  UserPlus,
  Swords,
  Trophy,
  Trash2,
  Flame,
} from 'lucide-react';
import { useNotificaciones } from '../hooks/useNotificaciones';
import { useJugadorAmigos } from '../hooks/useJugadorAmigos';
import { usePartidosMutations } from '../hooks/usePartidosAbiertos';
import { useDesafios } from '../hooks/useDesafios';
import { cn } from '@/lib/utils';

type FilterTab = 'todas' | 'partidos' | 'amigos' | 'desafios' | 'clubes';

export function NotificationsBell() {
  const { unreadCount, notificaciones, marcarLeida, marcarTodasLeidas, eliminarNotificacion } = useNotificaciones();
  const { solicitudesRecibidas, pendientesRecibidasCount, confirmarAmigo, rechazarAmigo } = useJugadorAmigos();
  const { responderInvitacion } = usePartidosMutations();
  const { aceptarDesafio, rechazarDesafio } = useDesafios();
  
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<FilterTab>('todas');
  const [processingIds, setProcessingIds] = useState<Record<string, boolean>>({});

  const totalUnread = unreadCount + pendientesRecibidasCount;

  // Filtrado de notificaciones por pestaña
  const notificacionesFiltradas = useMemo(() => {
    if (activeTab === 'todas') return notificaciones;
    if (activeTab === 'partidos') {
      return notificaciones.filter(n =>
        ['invitacion_partido', 'invitacion_aceptada', 'invitacion_rechazada', 'solicitud_unirse', 'solicitud_aceptada', 'solicitud_rechazada', 'reserva_confirmada', 'recordatorio_turno'].includes(n.tipo)
      );
    }
    if (activeTab === 'amigos') {
      return notificaciones.filter(n => ['solicitud_amigo', 'amistad_aceptada'].includes(n.tipo));
    }
    if (activeTab === 'desafios') {
      return notificaciones.filter(n => ['desafio_recibido', 'desafio_aceptado', 'desafio_rechazado'].includes(n.tipo));
    }
    if (activeTab === 'clubes') {
      return notificaciones.filter(n => n.tipo === 'noticia_club');
    }
    return notificaciones;
  }, [notificaciones, activeTab]);

  const handleAction = async (key: string, fn: () => Promise<any>) => {
    setProcessingIds(prev => ({ ...prev, [key]: true }));
    try {
      await fn();
    } catch (err) {
      console.error('Error al procesar acción:', err);
    } finally {
      setProcessingIds(prev => ({ ...prev, [key]: false }));
    }
  };

  const renderIcon = (tipo: string) => {
    switch (tipo) {
      case 'invitacion_partido':
      case 'solicitud_unirse':
      case 'solicitud_aceptada':
        return <Trophy className="h-4 w-4 text-emerald-600" />;
      case 'solicitud_amigo':
      case 'amistad_aceptada':
        return <UserPlus className="h-4 w-4 text-blue-600" />;
      case 'desafio_recibido':
      case 'desafio_aceptado':
        return <Swords className="h-4 w-4 text-amber-600" />;
      case 'reserva_confirmada':
      case 'recordatorio_turno':
        return <Calendar className="h-4 w-4 text-indigo-600" />;
      case 'noticia_club':
        return <Flame className="h-4 w-4 text-amber-500" />;
      case 'test':
      case 'general':
        return (
          <img
            src="/icons/icon.svg"
            alt="MatchGo"
            className="w-5 h-5 rounded-full object-cover"
          />
        );
      default:
        return <Bell className="h-4 w-4 text-slate-500" />;
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative flex h-10 w-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition active:scale-95"
        aria-label="Abrir notificaciones"
      >
        <Bell className="h-5 w-5 text-white" />
        {totalUnread > 0 && (
          <span className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-black text-white ring-2 ring-[#0B1F4D] animate-pulse">
            {totalUnread}
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
            style={{ maxHeight: '85dvh', paddingBottom: 'calc(env(safe-area-inset-bottom, 18px) + 20px)' }}
          >
            {/* Handler bar */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1.5 w-12 rounded-full bg-slate-300" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-white">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-extrabold text-slate-800">Notificaciones</h3>
                {totalUnread > 0 && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-600">
                    {totalUnread} nuevas
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

            {/* Filter Tabs */}
            <div className="flex items-center gap-2 px-4 py-2.5 bg-white border-b border-slate-100 overflow-x-auto no-scrollbar">
              {(
                [
                  { id: 'todas', label: 'Todas' },
                  { id: 'partidos', label: '🎾 Partidos' },
                  { id: 'amigos', label: '🤝 Amigos' },
                  { id: 'desafios', label: '⚔️ Desafíos' },
                  { id: 'clubes', label: '🔥 Clubes y Promos' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition',
                    activeTab === tab.id
                      ? 'bg-[#0B1F4D] text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Notifications List */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
              {/* Solicitudes de amistad pendientes de responder (siempre al tope en 'todas' o 'amigos') */}
              {(activeTab === 'todas' || activeTab === 'amigos') &&
                solicitudesRecibidas.map((amigo) => (
                  <div
                    key={`solicitud-${amigo.id}`}
                    className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200/90 shadow-sm flex flex-col gap-2"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-amber-500 text-white flex items-center justify-center font-extrabold text-xs shrink-0">
                        <UserPlus className="h-4 w-4 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-xs font-extrabold text-amber-900 leading-tight">
                          ¡Nueva solicitud de amistad!
                        </h4>
                        <p className="text-xs text-amber-800 font-medium mt-0.5 truncate">
                          <strong>{amigo.nombre_display}</strong> {amigo.alias ? `(@${amigo.alias})` : ''} quiere ser tu amigo.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-1 border-t border-amber-200/60">
                      <button
                        disabled={processingIds[`amigo-${amigo.id}`]}
                        onClick={() =>
                          handleAction(`amigo-${amigo.id}`, () => confirmarAmigo(amigo.id))
                        }
                        className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-extrabold px-3 py-1.5 rounded-lg transition"
                      >
                        Aceptar
                      </button>
                      <button
                        disabled={processingIds[`amigo-${amigo.id}`]}
                        onClick={() =>
                          handleAction(`amigo-${amigo.id}`, () => rechazarAmigo(amigo.id))
                        }
                        className="bg-slate-200/80 hover:bg-slate-300 disabled:opacity-50 text-slate-700 text-xs font-bold px-2.5 py-1.5 rounded-lg transition"
                      >
                        Rechazar
                      </button>
                    </div>
                  </div>
                ))}

              {notificacionesFiltradas.length === 0 && (activeTab !== 'todas' || solicitudesRecibidas.length === 0) ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-400 mb-4">
                    <Bell className="h-8 w-8" />
                  </div>
                  <p className="text-sm font-bold text-slate-700">¡Todo al día!</p>
                  <p className="text-xs text-slate-400 max-w-[240px] mt-1">
                    No tenés notificaciones pendientes en esta categoría.
                  </p>
                </div>
              ) : (
                notificacionesFiltradas.map((n) => {
                  const meta = n.metadata || {};
                  const isPartidoInvite = n.tipo === 'invitacion_partido' && meta.participante_id;
                  const isDesafio = n.tipo === 'desafio_recibido' && meta.desafio_id;
                  const isNoticiaClub = n.tipo === 'noticia_club';

                  return (
                    <div
                      key={n.id}
                      onClick={() => {
                        if (!n.leido) marcarLeida(n.id);
                      }}
                      className={cn(
                        'flex flex-col gap-2 p-3.5 rounded-2xl border transition-all',
                        n.leido
                          ? 'bg-white border-slate-100 opacity-80'
                          : 'bg-[#F3F4FD] border-indigo-100 hover:border-indigo-200 shadow-sm'
                      )}
                    >
                      <div className="flex items-start gap-3">
                        {/* Icon Badge */}
                        <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-xs shrink-0 border border-slate-100">
                          {renderIcon(n.tipo)}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <h4
                              className={cn(
                                'text-xs leading-tight truncate',
                                !n.leido ? 'font-extrabold text-slate-800' : 'font-semibold text-slate-600'
                              )}
                            >
                              {n.titulo}
                            </h4>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-slate-400 whitespace-nowrap">
                                {new Date(n.fecha).toLocaleDateString('es-AR', {
                                  day: '2-digit',
                                  month: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  eliminarNotificacion(n.id);
                                }}
                                className="text-slate-300 hover:text-red-500 transition p-0.5"
                                title="Eliminar notificación"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                          <p className="text-xs text-slate-600 mt-1 font-medium leading-relaxed">
                            {n.mensaje}
                          </p>

                          {/* Imagen adjunta en noticia/promo si existe */}
                          {isNoticiaClub && meta.imagen_url && (
                            <div className="mt-2 rounded-xl overflow-hidden max-h-36 w-full border border-slate-200/70 bg-slate-100">
                              <img
                                src={meta.imagen_url}
                                alt={n.titulo}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Botones de acción directa en la tarjeta de notificación si aplica */}
                      {isPartidoInvite && !n.leido && (
                        <div className="flex items-center justify-end gap-2 pt-2 mt-1 border-t border-indigo-100/60">
                          <button
                            disabled={processingIds[`part-${meta.participante_id}`]}
                            onClick={async (e) => {
                              e.stopPropagation();
                              await handleAction(`part-${meta.participante_id}`, async () => {
                                await responderInvitacion.mutateAsync({
                                  participanteId: Number(meta.participante_id),
                                  aceptar: true,
                                });
                                marcarLeida(n.id);
                              });
                            }}
                            className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-extrabold px-3 py-1.5 rounded-lg transition"
                          >
                            Aceptar Partido
                          </button>
                          <button
                            disabled={processingIds[`part-${meta.participante_id}`]}
                            onClick={async (e) => {
                              e.stopPropagation();
                              await handleAction(`part-${meta.participante_id}`, async () => {
                                await responderInvitacion.mutateAsync({
                                  participanteId: Number(meta.participante_id),
                                  aceptar: false,
                                });
                                marcarLeida(n.id);
                              });
                            }}
                            className="bg-slate-200 hover:bg-slate-300 disabled:opacity-50 text-slate-700 text-xs font-bold px-2.5 py-1.5 rounded-lg transition"
                          >
                            Rechazar
                          </button>
                        </div>
                      )}

                      {isDesafio && !n.leido && (
                        <div className="flex items-center justify-end gap-2 pt-2 mt-1 border-t border-indigo-100/60">
                          <button
                            disabled={processingIds[`desafio-${meta.desafio_id}`]}
                            onClick={async (e) => {
                              e.stopPropagation();
                              await handleAction(`desafio-${meta.desafio_id}`, async () => {
                                await aceptarDesafio(Number(meta.desafio_id));
                                marcarLeida(n.id);
                              });
                            }}
                            className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-extrabold px-3 py-1.5 rounded-lg transition"
                          >
                            Aceptar Desafío
                          </button>
                          <button
                            disabled={processingIds[`desafio-${meta.desafio_id}`]}
                            onClick={async (e) => {
                              e.stopPropagation();
                              await handleAction(`desafio-${meta.desafio_id}`, async () => {
                                await rechazarDesafio(Number(meta.desafio_id));
                                marcarLeida(n.id);
                              });
                            }}
                            className="bg-slate-200 hover:bg-slate-300 disabled:opacity-50 text-slate-700 text-xs font-bold px-2.5 py-1.5 rounded-lg transition"
                          >
                            Rechazar
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

