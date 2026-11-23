import { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useNoticiasAppFeed } from '../hooks/useNoticiasAppFeed';
import { 
  useInvitacionesPendientes, 
  usePartidosMutations, 
  usePartidosAbiertos 
} from '../hooks/usePartidosAbiertos';
import { formatFechaReserva, formatHoraReserva } from '../hooks/useMyReservas';

// Importar Diálogo del Perfil
import { PlayerProfileDialog } from './PlayerProfileDialog';
import { NoticiaCard } from './NoticiaCard';

/**
 * Feed Central Simple - Novedades en Carousel Continuo + Invitaciones Pendientes + Partidos Abiertos
 */
export function FeedCentralSimple() {
  const { data: noticias, isLoading: noticiasLoading } = useNoticiasAppFeed();
  
  // Invitaciones pendientes recibidas por amigos
  const { data: invitaciones, isLoading: invitesLoading } = useInvitacionesPendientes();
  const { partidos, isLoading: partidosLoading } = usePartidosAbiertos();
  const { responderInvitacion, solicitarUnirse } = usePartidosMutations();

  // ID del jugador_app actual
  const [miJugadorId, setMiJugadorId] = useState<string>('');

  // Estado para ver el perfil de un jugador
  const [activePlayerProfileId, setActivePlayerProfileId] = useState<string | null>(null);

  // Carousel state
  const [currentNoticiaIndex, setCurrentNoticiaIndex] = useState(0);
  const isInteractingRef = useRef(false);

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

  // Auto-play: una tarjeta a la vez (sin scroll horizontal anidado)
  useEffect(() => {
    if (!noticias || noticias.length <= 1) return;

    const interval = setInterval(() => {
      if (!isInteractingRef.current) {
        setCurrentNoticiaIndex((prev) => (prev + 1) % noticias.length);
      }
    }, 6000);

    return () => clearInterval(interval);
  }, [noticias]);

  useEffect(() => {
    if (!noticias || noticias.length === 0) return;
    if (currentNoticiaIndex >= noticias.length) {
      setCurrentNoticiaIndex(0);
    }
  }, [noticias, currentNoticiaIndex]);

  const goToSlide = (index: number) => {
    if (!noticias || noticias.length === 0) return;
    isInteractingRef.current = true;
    setCurrentNoticiaIndex(((index % noticias.length) + noticias.length) % noticias.length);
  };

  const prevSlide = () => {
    if (!noticias || noticias.length <= 1) return;
    goToSlide(currentNoticiaIndex - 1);
  };

  const nextSlide = () => {
    if (!noticias || noticias.length <= 1) return;
    goToSlide(currentNoticiaIndex + 1);
  };

  const isLoading = noticiasLoading || invitesLoading || partidosLoading;

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="h-48 bg-gray-100 rounded-2xl animate-pulse" />
        ))}
      </div>
    );
  }

  // Filtrar solo partidos futuros/activos para el feed de inicio
  const hoy = new Date().toISOString().slice(0, 10);
  const partidosActivos = (partidos ?? []).filter(p => {
    const fecha = p.reserva ? p.reserva.fecha : p.fecha_manual;
    return fecha && fecha >= hoy;
  });

  return (
    <div className="space-y-5">

      {/* ── Novedades del Club: Carousel Constante ── */}
      {noticias && noticias.length > 0 && (
        <div 
          className="relative w-full group"
          onMouseEnter={() => { isInteractingRef.current = true; }}
          onMouseLeave={() => { isInteractingRef.current = false; }}
          onTouchStart={() => { isInteractingRef.current = true; }}
          onTouchEnd={() => { 
            setTimeout(() => { isInteractingRef.current = false; }, 3000); 
          }}
        >
          <div
            className="w-full overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"
            onClick={() => { isInteractingRef.current = true; }}
          >
            {noticias[currentNoticiaIndex] && (
              <div key={noticias[currentNoticiaIndex].id} className="mgp-noticia-in">
                <NoticiaCard
                  noticia={noticias[currentNoticiaIndex]}
                  compact
                />
              </div>
            )}
          </div>

          {/* Flechas de navegación (si hay más de 1 noticia) */}
          {noticias.length > 1 && (
            <>
              <button
                type="button"
                onClick={prevSlide}
                aria-label="Anterior"
                className="absolute left-2 top-[104px] w-8 h-8 rounded-full bg-black/40 hover:bg-black/70 text-white flex items-center justify-center transition shadow-md opacity-70 hover:opacity-100 z-10"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={nextSlide}
                aria-label="Siguiente"
                className="absolute right-2 top-[104px] w-8 h-8 rounded-full bg-black/40 hover:bg-black/70 text-white flex items-center justify-center transition shadow-md opacity-70 hover:opacity-100 z-10"
              >
                <ChevronRight className="h-5 w-5" />
              </button>

              {/* Indicadores de puntos (Dots) */}
              <div className="flex justify-center items-center gap-1.5 pt-2">
                {noticias.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => goToSlide(idx)}
                    aria-label={`Ir a novedad ${idx + 1}`}
                    className={`h-2 rounded-full transition-all cursor-pointer ${
                      currentNoticiaIndex === idx
                        ? 'w-6 bg-[#1A9B73]'
                        : 'w-2 bg-gray-300 hover:bg-gray-400'
                    }`}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

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
            const orgId = p.organizador_id;

            return (
              <div key={inv.id} className="bg-white border border-indigo-100 p-3 rounded-xl shadow-sm flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  {p.organizador?.foto_url ? (
                    <div 
                      onClick={() => orgId && setActivePlayerProfileId(orgId)}
                      className="h-9 w-9 rounded-full bg-cover bg-center shrink-0 border border-indigo-200 cursor-pointer"
                      style={{ backgroundImage: `url(${p.organizador.foto_url})` }}
                    />
                  ) : (
                    <div 
                      onClick={() => orgId && setActivePlayerProfileId(orgId)}
                      className="h-9 w-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center font-extrabold text-xs shrink-0 cursor-pointer"
                    >
                      {orgNombre.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p 
                      onClick={() => orgId && setActivePlayerProfileId(orgId)}
                      className="text-xs font-bold text-slate-800 cursor-pointer hover:underline"
                    >
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

      {/* ── Partidos Abiertos / Convocatorias ── */}
      {partidosActivos && partidosActivos.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
            🎾 Partidos abiertos en la comunidad ({partidosActivos.length})
          </h3>
          
          {partidosActivos.map((p) => {
            const orgNombre = p.organizador?.nombre_display || 'Organizador';
            const orgAlias = p.organizador?.alias ? `@${p.organizador.alias}` : '';
            const orgId = p.organizador_id;
            const vacantesRestantes = p.faltan_jugadores ?? 1;
            const yaSolicito = p.participantes?.some(
              (part) => part.jugador_app_id === miJugadorId && !part.confirmado
            );
            const yaAceptado = p.participantes?.some(
              (part) => part.jugador_app_id === miJugadorId && part.confirmado
            );

            return (
              <div key={p.id} className="bg-white border border-slate-200 p-4 rounded-2xl shadow-sm space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    {p.organizador?.foto_url ? (
                      <div 
                        onClick={() => orgId && setActivePlayerProfileId(orgId)}
                        className="h-10 w-10 rounded-full bg-cover bg-center shrink-0 border border-slate-200 cursor-pointer"
                        style={{ backgroundImage: `url(${p.organizador.foto_url})` }}
                      />
                    ) : (
                      <div 
                        onClick={() => orgId && setActivePlayerProfileId(orgId)}
                        className="h-10 w-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center font-extrabold text-sm shrink-0 cursor-pointer"
                      >
                        {orgNombre.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p 
                        onClick={() => orgId && setActivePlayerProfileId(orgId)}
                        className="text-xs font-extrabold text-slate-900 cursor-pointer hover:underline"
                      >
                        {orgNombre} {orgAlias}
                      </p>
                      <p className="text-[11px] text-slate-500 font-medium">
                        📍 {p.reserva?.club?.nombre || p.club_nombre_manual || 'Club'}
                      </p>
                    </div>
                  </div>
                  <span className="text-[11px] font-black px-2.5 py-1 rounded-full bg-emerald-50 text-[#008F4C] border border-emerald-200">
                    {vacantesRestantes > 0 ? `${vacantesRestantes} vacantes` : 'Completo'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-700 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                  <span className="font-bold">
                    📅 {p.reserva ? formatFechaReserva(p.reserva.fecha) : (p.fecha_manual ? formatFechaReserva(p.fecha_manual) : '')}
                  </span>
                  <span className="font-bold text-[#00A859]">
                    🕒 {p.reserva ? formatHoraReserva(p.reserva.hora_inicio) : (p.hora_inicio_manual ? formatHoraReserva(p.hora_inicio_manual) : '')} hs
                  </span>
                </div>

                {p.nota && (
                  <p className="text-xs text-slate-600 italic">
                    "{p.nota}"
                  </p>
                )}

                <div className="flex items-center justify-between pt-1">
                  <div className="flex -space-x-2 overflow-hidden">
                    {p.participantes?.map((part: any, i: number) => (
                      <div
                        key={part.id || i}
                        className="inline-block h-6 w-6 rounded-full ring-2 ring-white bg-slate-200 text-slate-700 text-[10px] font-black flex items-center justify-center"
                        title={part.jugador?.nombre_display || 'Jugador'}
                      >
                        {(part.jugador?.nombre_display || 'J').charAt(0).toUpperCase()}
                      </div>
                    ))}
                  </div>

                  <div>
                    {yaAceptado ? (
                      <span className="text-[11px] text-[#008F4C] font-black bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                        Ya estás en el partido
                      </span>
                    ) : yaSolicito ? (
                      <span className="text-[11px] text-amber-600 font-bold italic">
                        Solicitud enviada...
                      </span>
                    ) : (
                      vacantesRestantes > 0 && (
                        <button
                          onClick={() => solicitarUnirse.mutate({ partidoId: p.id })}
                          disabled={solicitarUnirse.isPending}
                          className="bg-[#00A859] hover:bg-[#008F4C] text-white text-xs font-extrabold px-4 py-2 rounded-xl transition shadow-sm"
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

      {/* Empty state */}
      {(!noticias || noticias.length === 0) && (!invitaciones || invitaciones.length === 0) && (partidosActivos.length === 0) && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 py-12 text-center">
          <p style={{ fontSize: 14, color: '#64748B', fontWeight: 600 }}>No hay novedades ni partidos</p>
          <p style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>Vuelve más tarde 🎾</p>
        </div>
      )}

      {/* ── Dialog Perfil de Jugador ── */}
      {activePlayerProfileId && (
        <PlayerProfileDialog
          jugadorId={activePlayerProfileId}
          onClose={() => setActivePlayerProfileId(null)}
        />
      )}
    </div>
  );
}
