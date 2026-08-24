import { useState, useEffect } from 'react';
import { Heart, Users, Clock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useNoticiasAppFeed } from '../hooks/useNoticiasAppFeed';
import { useTurnosAbiertosApp } from '../hooks/useTurnosAbiertosApp';
import { 
  useInvitacionesPendientes, 
  usePartidosMutations, 
  usePartidosAbiertos 
} from '../hooks/usePartidosAbiertos';
import { formatFechaReserva, formatHoraReserva } from '../hooks/useMyReservas';

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function formatearFecha(iso: string): string {
  const parts = iso.split('-').map(Number);
  const y = parts[0] ?? new Date().getFullYear();
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const dt = new Date(y, m - 1, d);
  return `${DIAS[dt.getDay()]} ${d} ${MESES[m - 1]}`;
}

function formatearHora(time: string): string {
  return time.slice(0, 5);
}

/**
 * Feed Central Simple - Noticias + Turnos + Invitaciones Pendientes + Partidos Abiertos
 */
export function FeedCentralSimple() {
  const { data: noticias, isLoading: noticiasLoading } = useNoticiasAppFeed();
  const { data: turnosAbiertos, isLoading: turnosLoading } = useTurnosAbiertosApp();
  
  // Invitaciones pendientes recibidas por amigos
  const { data: invitaciones, isLoading: invitesLoading } = useInvitacionesPendientes();
  const { partidos, isLoading: partidosLoading } = usePartidosAbiertos();
  const { responderInvitacion, solicitarUnirse } = usePartidosMutations();

  // ID del jugador_app actual
  const [miJugadorId, setMiJugadorId] = useState<string>('');

  useEffect(() => {
    async function loadId() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data } = await supabase
          .from('jugadores_app')
          .select('id')
          .eq('auth_user_id', session.user.id)
          .maybeSingle();
        if (data) setMiJugadorId(data.id);
      }
    }
    void loadId();
  }, []);

  const isLoading = noticiasLoading || turnosLoading || invitesLoading || partidosLoading;

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-48 bg-gray-100 rounded-2xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* ── Invitaciones Recibidas de Amigos a Partidos ── */}
      {invitaciones && invitaciones.length > 0 && (
        <div className="space-y-3 bg-[#EEF2FF] border border-indigo-200 p-4 rounded-2xl">
          <h3 className="text-xs font-black uppercase tracking-wider text-indigo-900 flex items-center gap-1.5">
            <span className="flex h-2 w-2 rounded-full bg-indigo-600 animate-ping" />
            Invitaciones de Amigos ({invitaciones.length})
          </h3>
          
          {invitaciones.map((inv: any) => {
            const p = inv.partido;
            const orgNombre = p.organizador?.nombre_display || 'Un amigo';
            const orgAlias = p.organizador?.alias ? `@${p.organizador.alias}` : '';

            return (
              <div key={inv.id} className="bg-white border border-indigo-100 p-3 rounded-xl shadow-sm flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  {p.organizador?.foto_url ? (
                    <div 
                      className="h-9 w-9 rounded-full bg-cover bg-center shrink-0 border border-indigo-200"
                      style={{ backgroundImage: `url(${p.organizador.foto_url})` }}
                    />
                  ) : (
                    <div className="h-9 w-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center font-extrabold text-xs shrink-0">
                      {orgNombre.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-800">
                      {orgNombre} {orgAlias} te invitó a jugar
                    </p>
                    <p className="text-[11px] text-slate-500 font-medium truncate">
                      📍 {p.reserva?.club?.nombre || p.club_nombre_manual || 'Club'} ({p.reserva?.cancha?.nombre || p.cancha_nombre_manual || 'Cancha'})
                    </p>
                    <p className="text-[11px] text-indigo-600 font-bold">
                      📅 {p.reserva ? formatFechaReserva(p.reserva.fecha) : (p.fecha_manual ? formatFechaReserva(p.fecha_manual) : '')} · 🕒 {p.reserva ? formatHoraReserva(p.reserva.hora_inicio) : (p.hora_inicio_manual ? formatHoraReserva(p.hora_inicio_manual) : '')} hs
                    </p>
                  </div>
                </div>
                
                {p.nota && (
                  <p className="text-[11px] text-slate-600 italic bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-100">
                    "{p.nota}"
                  </p>
                )}
                
                <div className="flex gap-2 justify-end border-t border-slate-100 pt-2">
                  <button
                    onClick={() => responderInvitacion.mutate({ participanteId: inv.id, aceptar: true })}
                    disabled={responderInvitacion.isPending}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-extrabold px-3 py-1.5 rounded-lg transition"
                  >
                    Aceptar
                  </button>
                  <button
                    onClick={() => responderInvitacion.mutate({ participanteId: inv.id, aceptar: false })}
                    disabled={responderInvitacion.isPending}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-600 text-[11px] font-bold px-3 py-1.5 rounded-lg transition"
                  >
                    Rechazar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Partidos Abiertos de la Comunidad ── */}
      {partidos && partidos.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-black uppercase tracking-widest text-gray-500 px-2">
            🎾 Partidos abiertos de la comunidad
          </h3>
          {partidos.slice(0, 5).map((p) => {
            const esOrganizador = p.organizador_id === miJugadorId;
            const confirmados = p.participantes.filter(pt => pt.confirmado);
            const vacantesRestantes = Math.max(0, p.faltan_jugadores - confirmados.length);
            
            const esParticipante = confirmados.find(pt => pt.jugador_app_id === miJugadorId);
            const invitacionPendiente = p.participantes.find(pt => pt.jugador_app_id === miJugadorId && !pt.confirmado && pt.solicitado_by === 'organizador');
            const solicitudPendiente = p.participantes.find(pt => pt.jugador_app_id === miJugadorId && !pt.confirmado && pt.solicitado_by === 'jugador');

            return (
              <div
                key={p.id}
                className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    {p.organizador?.foto_url ? (
                      <div 
                        className="h-8 w-8 rounded-full bg-cover bg-center shrink-0 border border-slate-200"
                        style={{ backgroundImage: `url(${p.organizador.foto_url})` }}
                      />
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-indigo-50 text-indigo-700 flex items-center justify-center font-bold text-xs shrink-0 border border-indigo-200">
                        {p.organizador?.nombre_display?.charAt(0).toUpperCase() || 'JG'}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-800 truncate">
                        {p.organizador?.nombre_display || 'Jugador'}
                      </p>
                      <p className="text-[10px] text-slate-400">Organizador</p>
                    </div>
                  </div>

                  <span className="text-[10px] font-black bg-indigo-50 text-indigo-700 px-2.5 py-0.5 rounded-full uppercase">
                    {p.categoria}
                  </span>
                </div>

                <div className="bg-slate-50 p-2.5 rounded-xl text-xs space-y-1">
                  <p className="font-bold text-slate-800">
                    📍 {p.reserva?.club?.nombre || p.club_nombre_manual || 'Club'} <span className="font-normal text-slate-500">({p.reserva?.cancha?.nombre || p.cancha_nombre_manual || 'Cancha'})</span>
                  </p>
                  <p className="text-slate-600">
                    📅 {p.reserva ? formatFechaReserva(p.reserva.fecha) : (p.fecha_manual ? formatFechaReserva(p.fecha_manual) : '')} · 🕒 {p.reserva ? formatHoraReserva(p.reserva.hora_inicio) : (p.hora_inicio_manual ? formatHoraReserva(p.hora_inicio_manual) : '')} hs
                  </p>
                  {p.nota && (
                    <p className="text-[11px] text-slate-500 italic mt-1 border-t border-slate-100 pt-1">
                      "{p.nota}"
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className={`text-[11px] font-bold ${vacantesRestantes > 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {vacantesRestantes > 0 ? `⚡ Faltan ${vacantesRestantes} jugadores` : '🚫 Completo'}
                  </span>

                  <div>
                    {esOrganizador ? (
                      <span className="text-[10px] text-slate-400 font-semibold italic">Tu partido</span>
                    ) : esParticipante ? (
                      <span className="text-[11px] text-green-600 font-bold">✓ Anotado</span>
                    ) : invitacionPendiente ? (
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => responderInvitacion.mutate({ participanteId: invitacionPendiente.id, aceptar: true })}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold px-2 py-1 rounded transition"
                        >
                          Aceptar
                        </button>
                        <button
                          onClick={() => responderInvitacion.mutate({ participanteId: invitacionPendiente.id, aceptar: false })}
                          className="bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-bold px-2 py-1 rounded transition"
                        >
                          No
                        </button>
                      </div>
                    ) : solicitudPendiente ? (
                      <span className="text-[11px] text-amber-600 font-bold italic">Enviada...</span>
                    ) : (
                      vacantesRestantes > 0 && (
                        <button
                          onClick={() => solicitarUnirse.mutate({ partidoId: p.id })}
                          disabled={solicitarUnirse.isPending}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-extrabold px-3 py-1.5 rounded-lg transition"
                        >
                          Unirme
                        </button>
                      )
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Noticias */}
      {noticias && noticias.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-black uppercase tracking-widest text-gray-500 px-2">
            📰 Novedades del club
          </h3>
          {noticias.map((noticia) => (
            <div
              key={noticia.id}
              className="rounded-2xl overflow-hidden border border-gray-200 bg-white shadow-sm hover:shadow-md transition"
            >
              {/* Imagen (si existe) - Formato banner 16:9 */}
              {noticia.imagen_url && (
                <div className="relative w-full overflow-hidden" style={{ aspectRatio: '16/9', background: '#F1F5F9' }}>
                  <img
                    src={noticia.imagen_url}
                    alt={noticia.titulo}
                    className="w-full h-full object-cover"
                    onError={(e) => (e.currentTarget.style.display = 'none')}
                  />
                  {/* Overlay gradient */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                </div>
              )}

              {/* Contenido */}
              <div className="px-4 py-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <h4 className="font-bold text-gray-900 text-sm">{noticia.titulo}</h4>
                    <p className="text-xs text-gray-500 mt-0.5">{noticia.club_nombre}</p>
                  </div>
                </div>

                {noticia.descripcion && (
                  <p className="text-xs text-gray-600 line-clamp-2">{noticia.descripcion}</p>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                  <p className="text-xs text-gray-400">
                    {new Date(noticia.creado_en).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
                  </p>
                  <button className="text-xs font-semibold text-red-600 hover:text-red-700 flex items-center gap-1">
                    <Heart className="h-3 w-3" />
                    Me gusta
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Turnos abiertos */}
      {turnosAbiertos && turnosAbiertos.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-black uppercase tracking-widest text-gray-500 px-2">
            🎾 Turnos disponibles esta semana
          </h3>
          {turnosAbiertos.slice(0, 4).map((turno) => (
            <div
              key={`${turno.club_id}|${turno.cancha_id}|${turno.fecha}|${turno.hora_inicio}`}
              className="rounded-2xl border border-green-200 bg-green-50 p-3 shadow-sm"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <p className="text-xs font-bold text-green-900">{turno.club_nombre}</p>
                  <p className="text-xs text-green-700">{turno.cancha_nombre}</p>
                </div>
                <div className="flex items-center gap-1 bg-green-200 text-green-900 px-2 py-1 rounded-full">
                  <Users className="h-3 w-3" />
                  <span className="text-xs font-bold">{turno.vacias}</span>
                </div>
              </div>

              <div className="flex items-center gap-3 text-xs text-green-800">
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  <span className="font-semibold">
                    {formatearFecha(turno.fecha)} · {formatearHora(turno.hora_inicio)}
                  </span>
                </div>
                <span className="text-green-600 font-bold">
                  ${turno.precio.toLocaleString('es-AR')}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {(!noticias || noticias.length === 0) && (!turnosAbiertos || turnosAbiertos.length === 0) && (!invitaciones || invitaciones.length === 0) && (!partidos || partidos.length === 0) && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 py-12 text-center">
          <p style={{ fontSize: 14, color: '#64748B', fontWeight: 600 }}>No hay novedades ni partidos</p>
          <p style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>Vuelve más tarde 🎾</p>
        </div>
      )}
    </div>
  );
}
