import { useState, useEffect } from 'react';
import { formatFechaReserva, formatHoraReserva, useMyReservas } from '../hooks/useMyReservas';
import { useJugadorAmigos } from '../hooks/useJugadorAmigos';
import { supabase } from '@/lib/supabase';
import { 
  usePartidosAbiertos, 
  usePartidosMutations
} from '../hooks/usePartidosAbiertos';

const CATEGORIAS = ['Todos', '5ta', '6ta', '7ta', '8va', 'Abierto'];

export function JugarTab() {
  const [selectedCategoria, setSelectedCategoria] = useState<string>('Todos');
  const [modalOpen, setModalOpen] = useState(false);
  const [friendsModalOpen, setFriendsModalOpen] = useState(false);
  const [activePartidoIdForFriends, setActivePartidoIdForFriends] = useState<number | null>(null);
  
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
  const { partidos, isLoading: loadingPartidos } = usePartidosAbiertos();

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
      await publicarPartido.mutateAsync({
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

      // Limpiar formulario y cerrar modal
      setSelectedReservaId('manual');
      setNota('');
      setClubNombreManual('');
      setCanchaNombreManual('Cancha 1');
      setVisibilidad('cualquiera');
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

      {/* ── Lista de Partidos Abiertos Reales ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {loadingPartidos ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🎾</div>
            <p style={{ fontSize: 14, color: '#64748B' }}>Cargando partidos...</p>
          </div>
        ) : partidosFiltrados.length === 0 ? (
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
          partidosFiltrados.map(p => {
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
                style={{
                  background: '#ffffff',
                  borderRadius: 20,
                  border: '1.5px solid #E2E8F0',
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  boxShadow: '0 2px 10px rgba(0,0,0,0.04)',
                }}
              >
                {/* Organizador y Visibilidad */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {p.organizador?.foto_url ? (
                      <div
                        style={{
                          width: 40, height: 40, borderRadius: '50%',
                          backgroundImage: `url(${p.organizador.foto_url})`,
                          backgroundSize: 'cover', backgroundPosition: 'center',
                          border: '2px solid #39C54A'
                        }}
                      />
                    ) : (
                      <div style={{
                        width: 40, height: 40, borderRadius: '50%',
                        background: 'linear-gradient(135deg, #0B1F4D 0%, #162d6b 100%)',
                        color: '#ffffff', fontWeight: 800, fontSize: 14,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: "'Poppins', sans-serif",
                        border: '2px solid #D9F23B',
                      }}>
                        {p.organizador?.nombre_display?.charAt(0).toUpperCase() || 'JG'}
                      </div>
                    )}
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#0B1F4D' }}>
                        {p.organizador?.nombre_display || 'Jugador'} {p.organizador?.alias ? `(@${p.organizador.alias})` : ''}
                      </div>
                      <div style={{ fontSize: 11, color: '#64748B', fontWeight: 500 }}>
                        {esOrganizador ? 'Organizado por vos' : 'Organizador'}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{
                      fontSize: 10, fontWeight: 800,
                      color: p.visibilidad === 'amigos' ? '#D97706' : '#1D4ED8',
                      background: p.visibilidad === 'amigos' ? '#FEF3C7' : '#DBEAFE',
                      borderRadius: 12, padding: '4px 10px', textTransform: 'uppercase'
                    }}>
                      🔒 {p.visibilidad === 'amigos' ? 'Amigos' : 'Público'}
                    </span>
                    <span style={{
                      fontSize: 11, fontWeight: 800,
                      color: '#0B1F4D', background: '#D9F23B',
                      borderRadius: 12, padding: '4px 10px'
                    }}>
                      {p.categoria}
                    </span>
                  </div>
                </div>

                {/* Detalle del Turno */}
                <div style={{ background: '#F8F9FC', borderRadius: 14, padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#0B1F4D' }}>
                    📍 {p.reserva?.club?.nombre || p.club_nombre_manual || 'Club'} <span style={{ fontWeight: 500, color: '#64748B' }}>({p.reserva?.cancha?.nombre || p.cancha_nombre_manual || 'Cancha'})</span>
                  </div>
                  <div style={{ fontSize: 13, color: '#374151', fontWeight: 600 }}>
                    📅 {p.reserva ? formatFechaReserva(p.reserva.fecha) : (p.fecha_manual ? formatFechaReserva(p.fecha_manual) : '')} · 🕒 {p.reserva ? formatHoraReserva(p.reserva.hora_inicio) : (p.hora_inicio_manual ? formatHoraReserva(p.hora_inicio_manual) : '')} hs
                  </div>
                  {p.nota && (
                    <div style={{ fontSize: 12, color: '#64748B', fontStyle: 'italic', marginTop: 4, background: '#ffffff', padding: '6px 10px', borderRadius: 8, border: '1px solid #E2E8F0' }}>
                      "{p.nota}"
                    </div>
                  )}
                </div>

                {/* Participantes confirmados */}
                {confirmados.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 4px' }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: '#64748B', margin: 0 }}>PARTICIPANTES CONFIRMADOS:</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {confirmados.map(pt => (
                        <div key={pt.id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#F1F5F9', padding: '4px 8px', borderRadius: 20 }}>
                          <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#CBD5E1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 'bold' }}>
                            {pt.jugador?.nombre_display?.charAt(0).toUpperCase() || 'P'}
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#334155' }}>
                            {pt.jugador?.nombre_display}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Acciones de la Tarjeta */}
                <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{
                      fontSize: 12, fontWeight: 700,
                      color: vacantesRestantes > 0 ? '#16A34A' : '#DC2626', 
                      background: vacantesRestantes > 0 ? '#F0FDF4' : '#FEF2F2',
                      border: `1px solid ${vacantesRestantes > 0 ? '#BBF7D0' : '#FECACA'}`, 
                      padding: '4px 10px', borderRadius: 20
                    }}>
                      {vacantesRestantes > 0 ? `⚡ Faltan ${vacantesRestantes} jugadores` : '🚫 Partido completo'}
                    </span>

                    {/* Controles de Organizador */}
                    {esOrganizador && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          onClick={() => handleOpenFriendsModal(p.id)}
                          style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid #E2E8F0', background: '#ffffff', color: '#0B1F4D', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
                        >
                          ➕ Invitar amigos
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if(confirm('¿Seguro que querés cancelar la búsqueda de este partido?')) {
                              await eliminarPartido.mutateAsync(p.id);
                            }
                          }}
                          style={{ padding: '8px 12px', borderRadius: 10, border: 'none', background: '#FEE2E2', color: '#DC2626', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
                        >
                          🗑️ Cancelar
                        </button>
                      </div>
                    )}

                    {/* Controles de Tercero / Amigo */}
                    {!esOrganizador && (
                      <div>
                        {esParticipante ? (
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <span style={{ fontSize: 12, color: '#16A34A', fontWeight: 'bold' }}>✓ Ya estás anotado</span>
                            <button
                              onClick={() => responderInvitacion.mutate({ participanteId: esParticipante.id, aceptar: false })}
                              style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: '#F1F5F9', color: '#64748B', fontSize: 11, fontWeight: 'bold', cursor: 'pointer' }}
                            >
                              Salir
                            </button>
                          </div>
                        ) : invitacionPendiente ? (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              onClick={() => responderInvitacion.mutate({ participanteId: invitacionPendiente.id, aceptar: true })}
                              style={{ padding: '8px 14px', borderRadius: 10, border: 'none', background: '#10B981', color: '#ffffff', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}
                            >
                              Aceptar Inv.
                            </button>
                            <button
                              onClick={() => responderInvitacion.mutate({ participanteId: invitacionPendiente.id, aceptar: false })}
                              style={{ padding: '8px 12px', borderRadius: 10, border: 'none', background: '#F1F5F9', color: '#64748B', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
                            >
                              Rechazar
                            </button>
                          </div>
                        ) : solicitudPendiente ? (
                          <span style={{ fontSize: 12, color: '#D97706', fontWeight: 'bold', fontStyle: 'italic' }}>
                            Solicitud enviada...
                          </span>
                        ) : (
                          vacantesRestantes > 0 && (
                            <button
                              type="button"
                              onClick={() => solicitarUnirse.mutate({ partidoId: p.id })}
                              disabled={solicitarUnirse.isPending}
                              style={{
                                padding: '10px 18px',
                                borderRadius: 12,
                                border: 'none',
                                background: '#39C54A',
                                color: '#0B1F4D',
                                fontWeight: 800,
                                fontSize: 13,
                                cursor: 'pointer',
                                boxShadow: '0 2px 8px rgba(57,197,74,0.3)',
                              }}
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: '#FFFBEB', border: '1px dashed #FDE68A', padding: 10, borderRadius: 12, marginTop: 4 }}>
                      <p style={{ fontSize: 11, fontWeight: 800, color: '#B45309', margin: 0 }}>SOLICITUDES DE UNIÓN PENDIENTES:</p>
                      {solicitudesEntrantes.map(sol => (
                        <div key={sol.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#78350F' }}>
                            {sol.jugador?.nombre_display}
                          </span>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              onClick={() => responderInvitacion.mutate({ participanteId: sol.id, aceptar: true })}
                              style={{ padding: '4px 8px', fontSize: 11, borderRadius: 6, border: 'none', background: '#10B981', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}
                            >
                              Aceptar
                            </button>
                            <button
                              onClick={() => responderInvitacion.mutate({ participanteId: sol.id, aceptar: false })}
                              style={{ padding: '4px 8px', fontSize: 11, borderRadius: 6, border: 'none', background: '#EF4444', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}
                            >
                              Rechazar
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>
            );
          })
        )}
      </div>

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
                    🕒 Hora: <span style={{ fontWeight: 500 }}>{formatHoraReserva(reservaSeleccionada.hora_inicio)} hs</span>
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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

    </div>
  );
}
