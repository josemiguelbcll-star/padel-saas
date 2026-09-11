import { useState, useEffect } from 'react';
import { formatFechaReserva, formatHoraReserva, useMyReservas } from '../hooks/useMyReservas';
import { useJugadorAmigos } from '../hooks/useJugadorAmigos';
import { supabase } from '@/lib/supabase';
import { 
  usePartidosAbiertos, 
  usePartidosMutations
} from '../hooks/usePartidosAbiertos';

// Diálogos de Perfil y Puntuación
import { PlayerProfileDialog } from '../components/PlayerProfileDialog';
import { CalificarParticipantesDialog } from '../components/CalificarParticipantesDialog';

const CATEGORIAS = ['Todos', '5ta', '6ta', '7ta', '8va', 'Abierto'];

function isPartidoPasado(p: any): boolean {
  const fechaStr = p.reserva ? p.reserva.fecha : p.fecha_manual;
  const horaStr = p.reserva ? p.reserva.hora_inicio : p.hora_inicio_manual;
  if (!fechaStr || !horaStr) return false;

  const [year, month, day] = fechaStr.split('-').map(Number);
  const [hour, minute] = horaStr.split(':').map(Number);

  const matchDateTime = new Date(year, month - 1, day, hour, minute);
  
  // Duración aproximada del partido: 2 horas
  matchDateTime.setHours(matchDateTime.getHours() + 2);
  
  return new Date() > matchDateTime;
}

export function JugarTab() {
  const [selectedCategoria, setSelectedCategoria] = useState<string>('Todos');
  const [modalOpen, setModalOpen] = useState(false);
  const [friendsModalOpen, setFriendsModalOpen] = useState(false);
  const [activePartidoIdForFriends, setActivePartidoIdForFriends] = useState<number | null>(null);
  
  // Estado para ver el perfil de un jugador
  const [activePlayerProfileId, setActivePlayerProfileId] = useState<string | null>(null);

  // Estados para puntuar participantes
  const [activePartidoIdForRating, setActivePartidoIdForRating] = useState<number | null>(null);
  const [activePartidoCategoriaForRating, setActivePartidoCategoriaForRating] = useState<string>('');

  // ID real del jugador_app en la BD
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

  // Hook de reservas del jugador
  const { proximas: reservasFuturas } = useMyReservas();
  
  // Hook de amigos confirmados
  const { amigosConfirmados } = useJugadorAmigos();

  // Hook de partidos abiertos de la BD
  const { partidos, isLoading: loadingPartidos, refetch } = usePartidosAbiertos();

  // Hook de mutaciones de partidos
  const { 
    publicarPartido, 
    invitarAmigo, 
    solicitarUnirse, 
    responderInvitacion, 
    eliminarPartido 
  } = usePartidosMutations();

  // Formulario de publicación
  const [selectedReservaId, setSelectedReservaId] = useState<string>('manual'); // 'manual' por defecto para dar la opción
  const [categoria, setCategoria] = useState('5ta');
  const [faltanJugadores, setFaltanJugadores] = useState(3); // 3 por defecto
  const [posicionBuscada, setPosicionBuscada] = useState('Cualquiera');
  const [nota, setNota] = useState('');
  const [visibilidad, setVisibilidad] = useState<'cualquiera' | 'amigos'>('cualquiera');

  // Amigos seleccionados para invitar en la creación
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([]);

  // Datos manuales (si no tiene reserva o elige no usarla)
  const [clubNombreManual, setClubNombreManual] = useState('');
  const [canchaNombreManual, setCanchaNombreManual] = useState('Cancha 1');
  const [fechaManual, setFechaManual] = useState(() => new Date().toISOString().slice(0, 10));
  const [horaInicioManual, setHoraInicioManual] = useState('19:00');

  // Filtrar partidos por categoría seleccionada en la cabecera
  const partidosFiltrados = partidos.filter(p => {
    if (selectedCategoria === 'Todos') return true;
    return p.categoria === selectedCategoria;
  });

  // Dividir partidos en activos (futuros) y pasados (historial para calificar)
  const partidosActivos = partidosFiltrados.filter(p => !isPartidoPasado(p));
  const partidosPasados = partidosFiltrados.filter(p => p.organizador_id === miJugadorId && isPartidoPasado(p));

  // Obtener info de la reserva seleccionada para mostrar en el formulario
  const reservaSeleccionada = reservasFuturas.find(r => r.id === Number(selectedReservaId));

  async function handlePublicar(e: React.FormEvent) {
    e.preventDefault();
    
    const isManual = selectedReservaId === 'manual' || !selectedReservaId;
    if (isManual && !clubNombreManual.trim()) {
      alert('Por favor, ingresá el nombre del club.');
      return;
    }

    try {
      const partido = await publicarPartido.mutateAsync({
        reservaId: isManual ? null : Number(selectedReservaId),
        categoria,
        faltanJugadores,
        posicionBuscada,
        nota,
        visibilidad,
        clubNombreManual: isManual ? clubNombreManual.trim() : undefined,
        canchaNombreManual: isManual ? canchaNombreManual.trim() : undefined,
        fechaManual: isManual ? fechaManual : undefined,
        horaInicioManual: isManual ? horaInicioManual : undefined,
      });

      // Invitar amigos seleccionados directamente
      if (partido && selectedFriendIds.length > 0) {
        for (const friendId of selectedFriendIds) {
          try {
            await invitarAmigo.mutateAsync({
              partidoId: partido.id,
              amigoId: friendId,
            });
          } catch (err) {
            console.error('Error al invitar amigo', friendId, err);
          }
        }
      }

      // Limpiar formulario y cerrar modal
      setSelectedReservaId('manual');
      setNota('');
      setClubNombreManual('');
      setCanchaNombreManual('Cancha 1');
      setVisibilidad('cualquiera');
      setSelectedFriendIds([]);
      setModalOpen(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al publicar partido');
    }
  }

  const handleOpenFriendsModal = (partidoId: number) => {
    setActivePartidoIdForFriends(partidoId);
    setFriendsModalOpen(true);
  };

  const handleCloseFriendsModal = () => {
    setFriendsModalOpen(false);
    setActivePartidoIdForFriends(null);
  };

  return (
    <div style={{ padding: 16, minHeight: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* ── Cabecera ── */}
      <p style={{ fontSize: 13, color: 'var(--mgp-muted)', marginBottom: 16, lineHeight: 1.5 }}>
        Encontrá gente de tu comunidad para jugar. Podés anotarte a un partido abierto de la comunidad o abrir uno en base a una cancha que tengas reservada (o cargar los datos manualmente).
      </p>

      {/* ── Filtro por Categoría ── */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-x',
          paddingBottom: 4,
          marginBottom: 20,
          scrollbarWidth: 'none',
        }}
      >
        {CATEGORIAS.map(cat => {
          const isActive = selectedCategoria === cat;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategoria(cat)}
              style={{
                padding: '8px 16px',
                borderRadius: 20,
                border: isActive ? 'none' : '1px solid #E2E8F0',
                background: isActive ? '#0B1F4D' : '#ffffff',
                color: isActive ? '#ffffff' : '#374151',
                fontSize: 13,
                fontWeight: isActive ? 700 : 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'background-color 0.15s, color 0.15s, border-color 0.15s',
                outline: 'none',
                flexShrink: 0,
              }}
            >
              {cat}
            </button>
          );
        })}
      </div>

      {/* ── Lista de Partidos Abiertos Activos ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {loadingPartidos ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🎾</div>
            <p style={{ fontSize: 14, color: '#64748B' }}>Cargando partidos...</p>
          </div>
        ) : partidosActivos.length === 0 ? (
          <div style={{ background: '#ffffff', borderRadius: 20, border: '1.5px solid #E2E8F0', padding: '40px 24px', textAlign: 'center', margin: 'auto 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🤝</div>
            <h3 style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 17, color: '#0B1F4D', margin: '0 0 6px' }}>
              Sin partidos disponibles
            </h3>
            <p style={{ fontSize: 13, color: '#64748B', maxWidth: 300, margin: '0 auto', lineHeight: 1.5 }}>
              Cuando alguien de tu red o zona publique una cancha y busque jugadores, va a aparecer acá.
            </p>
          </div>
        ) : (
          partidosActivos.map(p => {
            const esOrganizador = p.organizador_id === miJugadorId;
            const confirmados = p.participantes.filter(pt => pt.confirmado);
            const vacantesRestantes = Math.max(0, p.faltan_jugadores - confirmados.length);
            
            // Checks de participación de usuario actual
            const esParticipante = confirmados.find(pt => pt.jugador_app_id === miJugadorId);
            const invitacionPendiente = p.participantes.find(pt => pt.jugador_app_id === miJugadorId && !pt.confirmado && pt.solicitado_by === 'organizador');
            const solicitudPendiente = p.participantes.find(pt => pt.jugador_app_id === miJugadorId && !pt.confirmado && pt.solicitado_by === 'jugador');

            // Solicitudes entrantes para el organizador
            const solicitudesEntrantes = p.participantes.filter(pt => !pt.confirmado && pt.solicitado_by === 'jugador');

            return (
              <div
                key={p.id}
                className="bg-white rounded-2xl border border-slate-200/90 p-4 flex flex-col gap-3.5 shadow-sm hover:shadow-md transition duration-200"
              >
                {/* Organizador y Visibilidad */}
                <div className="flex items-center justify-between gap-2">
                  <div 
                    onClick={() => setActivePlayerProfileId(p.organizador_id)}
                    className="flex items-center gap-3 cursor-pointer min-w-0 flex-1 group"
                  >
                    {p.organizador?.foto_url ? (
                      <img
                        src={p.organizador.foto_url}
                        alt={p.organizador?.nombre_display || 'Jugador'}
                        className="w-11 h-11 rounded-full object-cover shrink-0 border-2 border-[#39C54A] shadow-xs group-hover:opacity-90 transition"
                      />
                    ) : (
                      <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[#0B1F4D] to-[#162d6b] text-white font-extrabold text-sm flex items-center justify-center shrink-0 border-2 border-[#D9F23B] shadow-xs font-['Poppins']">
                        {p.organizador?.nombre_display?.charAt(0).toUpperCase() || 'JG'}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-[#0B1F4D] truncate group-hover:text-primary transition">
                        {p.organizador?.nombre_display || 'Jugador'} {p.organizador?.alias ? `(@${p.organizador.alias})` : ''}
                      </div>
                      <div className="text-[11px] text-slate-500 font-medium">
                        {esOrganizador ? '⭐ Organizado por vos' : 'Organizador'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-full uppercase tracking-wider ${
                      p.visibilidad === 'amigos' 
                        ? 'text-amber-700 bg-amber-100/80 border border-amber-200' 
                        : 'text-blue-700 bg-blue-100/80 border border-blue-200'
                    }`}>
                      {p.visibilidad === 'amigos' ? '🔒 Amigos' : '🌐 Público'}
                    </span>
                    <span className="text-[11px] font-extrabold text-[#0B1F4D] bg-[#D9F23B] px-2.5 py-1 rounded-full border border-lime-400/50 shadow-2xs">
                      {p.categoria}
                    </span>
                  </div>
                </div>

                {/* Detalle del Turno */}
                <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 flex flex-col gap-1.5">
                  <div className="text-sm font-bold text-[#0B1F4D] flex items-center gap-1.5 truncate">
                    <span className="shrink-0 text-base">📍</span>
                    <span className="truncate">{p.reserva?.club?.nombre || p.club_nombre_manual || 'Club'}</span>
                    <span className="text-xs font-semibold text-slate-500 shrink-0">
                      ({p.reserva?.cancha?.nombre || p.cancha_nombre_manual || 'Cancha'})
                    </span>
                  </div>
                  <div className="text-xs text-slate-700 font-semibold flex items-center gap-1.5 flex-wrap">
                    <span className="shrink-0">📅</span>
                    <span>
                      {p.reserva ? formatFechaReserva(p.reserva.fecha) : (p.fecha_manual ? formatFechaReserva(p.fecha_manual) : '')}
                    </span>
                    <span className="text-slate-300">·</span>
                    <span className="shrink-0">🕒</span>
                    <span>
                      {p.reserva ? formatHoraReserva(p.reserva.hora_inicio) : (p.hora_inicio_manual ? formatHoraReserva(p.hora_inicio_manual) : '')} hs
                    </span>
                    {p.posicion_buscada && p.posicion_buscada !== 'Cualquiera' && (
                      <>
                        <span className="text-slate-300">·</span>
                        <span className="text-indigo-600 font-bold bg-indigo-50 px-2 py-0.5 rounded-md text-[11px] border border-indigo-100">
                          Posición: {p.posicion_buscada}
                        </span>
                      </>
                    )}
                  </div>
                  {p.nota && (
                    <div className="text-xs text-slate-600 italic bg-white p-2.5 rounded-xl border border-slate-200/60 mt-1 shadow-2xs leading-relaxed">
                      "{p.nota}"
                    </div>
                  )}
                </div>

                {/* Participantes confirmados */}
                {confirmados.length > 0 && (
                  <div className="space-y-1.5 px-0.5">
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                      Participantes confirmados ({confirmados.length}):
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {confirmados.map(pt => (
                        <div 
                          key={pt.id} 
                          onClick={() => setActivePlayerProfileId(pt.jugador_app_id)}
                          className="inline-flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200/80 px-2.5 py-1 rounded-full cursor-pointer transition text-xs"
                        >
                          {pt.jugador?.foto_url ? (
                            <img 
                              src={pt.jugador.foto_url} 
                              alt={pt.jugador?.nombre_display || 'Jugador'} 
                              className="w-4 h-4 rounded-full object-cover shrink-0" 
                            />
                          ) : (
                            <div className="w-4 h-4 rounded-full bg-slate-300 text-slate-800 flex items-center justify-center text-[9px] font-bold shrink-0">
                              {pt.jugador?.nombre_display?.charAt(0).toUpperCase() || 'P'}
                            </div>
                          )}
                          <span className="font-semibold text-slate-700">
                            {pt.jugador?.nombre_display}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── BANNER DESTACADO SI TE INVITARON AL PARTIDO ── */}
                {invitacionPendiente && (
                  <div className="p-3.5 rounded-2xl bg-gradient-to-br from-emerald-500/15 via-emerald-500/10 to-teal-500/5 border-2 border-emerald-500/40 shadow-xs flex flex-col gap-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold text-sm shrink-0 shadow-xs">
                        📩
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-extrabold text-emerald-950 dark:text-emerald-100 leading-tight">
                          ¡Te invitaron a jugar este partido!
                        </p>
                        <p className="text-[11px] text-emerald-800 dark:text-emerald-300 leading-tight">
                          Aceptá para confirmar tu lugar en la cancha.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-emerald-500/20">
                      <button
                        type="button"
                        onClick={() => responderInvitacion.mutate({ participanteId: invitacionPendiente.id, aceptar: true })}
                        disabled={responderInvitacion.isPending}
                        className="w-full py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white font-extrabold text-xs rounded-xl shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <span>✓ Aceptar Invitación</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => responderInvitacion.mutate({ participanteId: invitacionPendiente.id, aceptar: false })}
                        disabled={responderInvitacion.isPending}
                        className="w-full py-2.5 px-3 bg-white hover:bg-red-50 hover:text-red-600 hover:border-red-200 border border-slate-200 active:scale-98 text-slate-700 font-bold text-xs rounded-xl transition flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <span>✕ Rechazar</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* ── Footer de Estado y Acciones ── */}
                <div className="border-t border-slate-100 pt-3 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className={`text-xs font-extrabold px-3 py-1 rounded-full border ${
                      vacantesRestantes > 0 
                        ? 'text-emerald-700 bg-emerald-50 border-emerald-200' 
                        : 'text-red-700 bg-red-50 border-red-200'
                    }`}>
                      {vacantesRestantes > 0 ? `⚡ Faltan ${vacantesRestantes} jugadores` : '🚫 Partido completo'}
                    </span>

                    {/* Controles de Organizador */}
                    {esOrganizador && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleOpenFriendsModal(p.id)}
                          className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-[#0B1F4D] font-bold text-xs transition shadow-2xs flex items-center gap-1 cursor-pointer"
                        >
                          ➕ Invitar
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if(confirm('¿Seguro que querés cancelar la búsqueda de este partido?')) {
                              await eliminarPartido.mutateAsync(p.id);
                            }
                          }}
                          className="px-3 py-1.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 font-bold text-xs transition flex items-center gap-1 cursor-pointer"
                        >
                          🗑️ Cancelar
                        </button>
                      </div>
                    )}

                    {/* Controles de Jugador Anotado / Solicitud */}
                    {!esOrganizador && !invitacionPendiente && (
                      <div className="flex items-center gap-2">
                        {esParticipante ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-emerald-600 font-bold bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                              ✓ Ya estás anotado
                            </span>
                            <button
                              type="button"
                              onClick={() => responderInvitacion.mutate({ participanteId: esParticipante.id, aceptar: false })}
                              className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-red-50 hover:text-red-600 text-slate-600 text-xs font-bold transition cursor-pointer"
                            >
                              Salir
                            </button>
                          </div>
                        ) : solicitudPendiente ? (
                          <span className="text-xs text-amber-700 font-bold italic bg-amber-50 px-3 py-1 rounded-full border border-amber-200">
                            ⏳ Solicitud enviada...
                          </span>
                        ) : (
                          vacantesRestantes > 0 && (
                            <button
                              type="button"
                              onClick={() => solicitarUnirse.mutate({ partidoId: p.id })}
                              disabled={solicitarUnirse.isPending}
                              className="px-4 py-2 rounded-xl bg-[#39C54A] hover:bg-[#32b041] active:scale-98 text-[#0B1F4D] font-extrabold text-xs shadow-md shadow-emerald-500/20 transition flex items-center gap-1.5 cursor-pointer"
                            >
                              🎾 Solicitar unirme
                            </button>
                          )
                        )}
                      </div>
                    )}
                  </div>

                  {/* Solicitudes de ingreso pendientes (para el organizador) */}
                  {esOrganizador && solicitudesEntrantes.length > 0 && (
                    <div className="flex flex-col gap-2 bg-amber-50/80 border border-amber-200 p-3 rounded-2xl mt-1">
                      <p className="text-[10px] font-black uppercase tracking-wider text-amber-900">
                        Solicitudes de unión pendientes ({solicitudesEntrantes.length}):
                      </p>
                      <div className="space-y-1.5">
                        {solicitudesEntrantes.map(sol => (
                          <div key={sol.id} className="flex items-center justify-between gap-2 bg-white p-2 rounded-xl border border-amber-100 shadow-2xs">
                            <span 
                              onClick={() => setActivePlayerProfileId(sol.jugador_app_id)}
                              className="text-xs font-bold text-amber-950 cursor-pointer hover:underline truncate"
                            >
                              {sol.jugador?.nombre_display}
                            </span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => responderInvitacion.mutate({ participanteId: sol.id, aceptar: true })}
                                className="px-2.5 py-1 text-[11px] rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition shadow-xs cursor-pointer"
                              >
                                Aceptar
                              </button>
                              <button
                                type="button"
                                onClick={() => responderInvitacion.mutate({ participanteId: sol.id, aceptar: false })}
                                className="px-2.5 py-1 text-[11px] rounded-lg bg-red-50 hover:bg-red-100 text-red-600 font-bold transition cursor-pointer"
                              >
                                Rechazar
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Calificar Partidos Pasados (Solo si hay alguno del organizador en los últimos 7 días) ── */}
      {!loadingPartidos && partidosPasados.length > 0 && (
        <div style={{ marginTop: 24, borderTop: '2px dashed #E2E8F0', paddingTop: 20 }}>
          <h3 style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 800, fontSize: 16, color: '#0B1F4D', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            ⭐ Calificar jugadores de partidos pasados
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {partidosPasados.map(p => {
              const confirmados = p.participantes.filter(pt => pt.confirmado);
              const calificados = confirmados.every(pt => pt.asistio !== null);
              
              if (confirmados.length === 0) return null; // No hay a quién calificar
              
              return (
                <div 
                  key={p.id} 
                  style={{ 
                    background: '#ffffff', 
                    borderRadius: 16, 
                    border: '1.5px solid #E2E8F0', 
                    padding: 14, 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.02)'
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0, paddingRight: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0B1F4D', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      📍 {p.reserva?.club?.nombre || p.club_nombre_manual || 'Club'}
                    </div>
                    <div style={{ fontSize: 12, color: '#64748B', fontWeight: 500, marginTop: 2 }}>
                      📅 {p.reserva ? formatFechaReserva(p.reserva.fecha) : (p.fecha_manual ? formatFechaReserva(p.fecha_manual) : '')} · Cat: <strong>{p.categoria}</strong>
                    </div>
                  </div>
                  
                  {calificados ? (
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#16A34A', background: '#F0FDF4', padding: '6px 12px', borderRadius: 10, border: '1px solid #BBF7D0', flexShrink: 0 }}>
                      ✓ Calificado
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setActivePartidoIdForRating(p.id);
                        setActivePartidoCategoriaForRating(p.categoria);
                      }}
                      style={{ padding: '8px 12px', borderRadius: 10, border: 'none', background: '#D9F23B', color: '#0B1F4D', fontWeight: 800, fontSize: 12, cursor: 'pointer', flexShrink: 0 }}
                    >
                      ⭐ Calificar ({confirmados.length})
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Botón Publicar Partido ── */}
      <div style={{ padding: '20px 0 10px' }}>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          style={{
            width: '100%',
            padding: '16px',
            borderRadius: 16,
            border: 'none',
            background: '#0B1F4D',
            color: '#ffffff',
            fontWeight: 800,
            fontSize: 15,
            fontFamily: "'Inter', sans-serif",
            cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(11, 31, 77, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          🎾 Tengo cancha, busco jugadores
        </button>
      </div>

      {/* ── Modal Publicar Partido Abierto por Jugador ── */}
      {modalOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center'
        }}>
          <div style={{
            background: '#ffffff', width: '100%', maxWidth: 480,
            borderRadius: '24px 24px 0 0', padding: 24,
            boxShadow: '0 -4px 24px rgba(0,0,0,0.2)',
            maxHeight: '88vh', overflowY: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <h2 style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 800, fontSize: 18, color: '#0B1F4D', margin: 0 }}>
                Abrir partido a la comunidad
              </h2>
              <button
                type="button"
                onClick={() => {
                  setSelectedReservaId('manual');
                  setSelectedFriendIds([]);
                  setModalOpen(false);
                }}
                style={{ background: '#F1F5F9', border: 'none', borderRadius: 99, width: 32, height: 32, cursor: 'pointer', fontWeight: 700, color: '#64748B' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handlePublicar} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              
              {/* Selector de reserva activa (opcional) */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#0B1F4D', display: 'block', marginBottom: 4 }}>
                  Cancha Reservada (opcional)
                </label>
                <select
                  value={selectedReservaId}
                  onChange={e => setSelectedReservaId(e.target.value)}
                  style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1.5px solid #E2E8F0', fontSize: 14, outline: 'none', background: '#fff' }}
                >
                  <option value="manual">-- Cargar datos manualmente --</option>
                  {reservasFuturas.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.club_nombre} · {r.cancha_nombre} · {formatFechaReserva(r.fecha)} {formatHoraReserva(r.hora_inicio)} hs
                    </option>
                  ))}
                </select>
              </div>

              {/* Relleno automático de reserva */}
              {selectedReservaId !== 'manual' && reservaSeleccionada && (
                <div style={{ background: '#F8F9FC', padding: 12, borderRadius: 12, border: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>
                    📍 Club: <span style={{ fontWeight: 500 }}>{reservaSeleccionada.club_nombre} ({reservaSeleccionada.cancha_nombre})</span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>
                    📅 Fecha: <span style={{ fontWeight: 500 }}>{formatFechaReserva(reservaSeleccionada.fecha)}</span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>
                    🕒 Hora: <span style={{ fontWeight: 500 }}>{formatHoraReserva(reservaSeleccionada.hora_inicio) } hs</span>
                  </div>
                </div>
              )}

              {/* Formulario manual (si selectedReservaId es 'manual') */}
              {selectedReservaId === 'manual' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12, fontWeight: 700, color: '#0B1F4D', display: 'block', marginBottom: 4 }}>Club / Lugar *</label>
                      <input
                        type="text"
                        required
                        placeholder="Ej: Tucán Pádel Center"
                        value={clubNombreManual}
                        onChange={e => setClubNombreManual(e.target.value)}
                        style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1.5px solid #E2E8F0', fontSize: 14, outline: 'none' }}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12, fontWeight: 700, color: '#0B1F4D', display: 'block', marginBottom: 4 }}>Cancha</label>
                      <input
                        type="text"
                        placeholder="Ej: Cancha 1"
                        value={canchaNombreManual}
                        onChange={e => setCanchaNombreManual(e.target.value)}
                        style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1.5px solid #E2E8F0', fontSize: 14, outline: 'none' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12, fontWeight: 700, color: '#0B1F4D', display: 'block', marginBottom: 4 }}>Fecha *</label>
                      <input
                        type="date"
                        required
                        value={fechaManual}
                        onChange={e => setFechaManual(e.target.value)}
                        style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1.5px solid #E2E8F0', fontSize: 14, outline: 'none' }}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12, fontWeight: 700, color: '#0B1F4D', display: 'block', marginBottom: 4 }}>Hora *</label>
                      <input
                        type="time"
                        required
                        value={horaInicioManual}
                        onChange={e => setHoraInicioManual(e.target.value)}
                        style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1.5px solid #E2E8F0', fontSize: 14, outline: 'none' }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Visibilidad del Partido */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#0B1F4D', display: 'block', marginBottom: 4 }}>Visibilidad *</label>
                <select
                  value={visibilidad}
                  onChange={e => setVisibilidad(e.target.value as any)}
                  style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1.5px solid #E2E8F0', fontSize: 14, outline: 'none', background: '#fff' }}
                >
                  <option value="cualquiera">🌎 Cualquiera (Público a todos los jugadores)</option>
                  <option value="amigos">🔒 Solo mis amigos (Visible para tus amigos confirmados)</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: '#0B1F4D', display: 'block', marginBottom: 4 }}>Categoría</label>
                  <select
                    value={categoria}
                    onChange={e => setCategoria(e.target.value)}
                    style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1.5px solid #E2E8F0', fontSize: 14, outline: 'none', background: '#fff' }}
                  >
                    {['5ta', '6ta', '7ta', '8va', 'Abierto'].map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: '#0B1F4D', display: 'block', marginBottom: 4 }}>Buscás (jugadores)</label>
                  <select
                    value={faltanJugadores}
                    onChange={e => setFaltanJugadores(Number(e.target.value))}
                    style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1.5px solid #E2E8F0', fontSize: 14, outline: 'none', background: '#fff' }}
                  >
                    <option value={1}>1 jugador</option>
                    <option value={2}>2 jugadores</option>
                    <option value={3}>3 jugadores</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#0B1F4D', display: 'block', marginBottom: 4 }}>Posición buscada</label>
                <select
                  value={posicionBuscada}
                  onChange={e => setPosicionBuscada(e.target.value)}
                  style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1.5px solid #E2E8F0', fontSize: 14, outline: 'none', background: '#fff' }}
                >
                  <option value="Cualquiera">Cualquier posición</option>
                  <option value="Revés">Revés (Izquierda)</option>
                  <option value="Drive">Drive (Derecha)</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#0B1F4D', display: 'block', marginBottom: 4 }}>Nota / Mensaje</label>
                <input
                  type="text"
                  placeholder="Ej: Buscamos 5ta parejo..."
                  value={nota}
                  onChange={e => setNota(e.target.value)}
                  style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1.5px solid #E2E8F0', fontSize: 14, outline: 'none' }}
                />
              </div>

              {/* Seleccionar amigos a invitar directamente */}
              {amigosConfirmados.length > 0 && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 700, color: '#0B1F4D', display: 'block', marginBottom: 6 }}>
                    Invitar amigos directamente (opcional)
                  </label>
                  <div style={{
                    maxHeight: 120, overflowY: 'auto',
                    border: '1.5px solid #E2E8F0', borderRadius: 12,
                    padding: 8, display: 'flex', flexDirection: 'column', gap: 6
                  }}>
                    {amigosConfirmados.map(amigo => {
                      const isChecked = selectedFriendIds.includes(amigo.id);
                      return (
                        <label
                          key={amigo.id}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            fontSize: 13, color: '#374151', cursor: 'pointer',
                            padding: '4px 6px', borderRadius: 8,
                            background: isChecked ? '#F0FDF4' : 'transparent',
                            transition: 'background-color 0.15s'
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedFriendIds(prev => [...prev, amigo.id]);
                              } else {
                                setSelectedFriendIds(prev => prev.filter(id => id !== amigo.id));
                              }
                            }}
                            style={{ cursor: 'pointer' }}
                          />
                          <span style={{ fontWeight: 600 }}>{amigo.nombre_display}</span>
                          {amigo.alias && (
                            <span style={{ fontSize: 11, color: '#94A3B8' }}>@{amigo.alias}</span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={publicarPartido.isPending}
                style={{ marginTop: 6, padding: '16px', borderRadius: 14, border: 'none', background: '#39C54A', color: '#0B1F4D', fontWeight: 800, fontSize: 15, cursor: 'pointer', boxShadow: '0 4px 14px rgba(57,197,74,0.3)' }}
              >
                {publicarPartido.isPending ? 'Publicando...' : '🚀 Publicar Partido'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal Invitar Amigos (para el Organizador) ── */}
      {friendsModalOpen && activePartidoIdForFriends !== null && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16
        }}>
          <div style={{
            background: '#ffffff', width: '100%', maxWidth: 400,
            borderRadius: 24, padding: 20,
            boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
            maxHeight: '80vh', display: 'flex', flexDirection: 'column'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 800, fontSize: 16, color: '#0B1F4D', margin: 0 }}>
                Invitar amigos al partido
              </h3>
              <button
                type="button"
                onClick={handleCloseFriendsModal}
                style={{ background: '#F1F5F9', border: 'none', borderRadius: 99, width: 28, height: 28, cursor: 'pointer', fontWeight: 700, color: '#64748B' }}
              >
                ✕
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingRight: 4 }}>
              {amigosConfirmados.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px 10px', color: '#64748B', fontSize: 13 }}>
                  Aún no tenés amigos confirmados para invitar. ¡Agrega amigos en Comunidad!
                </div>
              ) : (
                amigosConfirmados.map(amigo => {
                  const partido = partidos.find(p => p.id === activePartidoIdForFriends);
                  const yaAsociado = partido?.participantes.some(pt => pt.jugador_app_id === amigo.id);

                  return (
                    <div
                      key={amigo.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 12px',
                        border: '1px solid #E2E8F0',
                        borderRadius: 14,
                      }}
                    >
                      <div 
                        onClick={() => setActivePlayerProfileId(amigo.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                      >
                        <div style={{
                          width: 32, height: 32, borderRadius: '50%',
                          background: 'linear-gradient(135deg, #0B1F4D 0%, #162d6b 100%)',
                          color: '#ffffff', fontWeight: 800, fontSize: 12,
                          display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                          {amigo.nombre_display.charAt(0).toUpperCase()}
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#1E293B' }}>
                          {amigo.nombre_display}
                        </span>
                      </div>

                      <button
                        type="button"
                        disabled={yaAsociado || invitarAmigo.isPending}
                        onClick={async () => {
                          await invitarAmigo.mutateAsync({
                            partidoId: activePartidoIdForFriends,
                            amigoId: amigo.id,
                          });
                        }}
                        style={{
                          padding: '6px 12px',
                          borderRadius: 8,
                          border: 'none',
                          background: yaAsociado ? '#F1F5F9' : '#0B1F4D',
                          color: yaAsociado ? '#94A3B8' : '#ffffff',
                          fontWeight: 700,
                          fontSize: 11,
                          cursor: yaAsociado ? 'default' : 'pointer'
                        }}
                      >
                        {yaAsociado ? 'Invitado' : 'Invitar'}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Dialog Perfil de Jugador ── */}
      {activePlayerProfileId && (
        <PlayerProfileDialog
          jugadorId={activePlayerProfileId}
          onClose={() => setActivePlayerProfileId(null)}
        />
      )}

      {/* ── Dialog Calificar Oponentes ── */}
      {activePartidoIdForRating !== null && (
        <CalificarParticipantesDialog
          partidoId={activePartidoIdForRating}
          categoria={activePartidoCategoriaForRating}
          onClose={() => {
            setActivePartidoIdForRating(null);
            setActivePartidoCategoriaForRating('');
          }}
          onSuccess={() => {
            alert('¡Puntuaciones guardadas correctamente!');
            setActivePartidoIdForRating(null);
            setActivePartidoCategoriaForRating('');
            // Refrescar partidos abiertos
            void refetch();
          }}
        />
      )}

    </div>
  );
}
