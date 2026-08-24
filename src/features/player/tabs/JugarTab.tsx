import { useState, useEffect } from 'react';
import { usePlayerProfile } from '../hooks/usePlayerProfile';
import { formatFechaReserva, formatHoraReserva } from '../hooks/useMyReservas';

export interface PartidoJugadorReal {
  id: string;
  organizadorNombre: string;
  organizadorAlias?: string;
  organizadorAvatar?: string;
  clubNombre: string;
  canchaNombre: string;
  fecha: string; // YYYY-MM-DD
  horaInicio: string; // HH:MM
  categoria: string; // "5ta", "6ta", "7ta", "8va", "Abierto"
  faltanJugadores: number; // 1, 2, 3
  posicionBuscada?: string;
  nota?: string;
  creadoEn: string;
}

const CATEGORIAS = ['Todos', '5ta', '6ta', '7ta', '8va', 'Abierto'];
const STORAGE_KEY = 'mg_partidos_comunidad_v1';

function getSavedPartidos(): PartidoJugadorReal[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Filtrar fechas pasadas
    const hoy = new Date().toISOString().slice(0, 10);
    return parsed.filter((p: PartidoJugadorReal) => p.fecha >= hoy);
  } catch {
    return [];
  }
}

function savePartidosToStorage(list: PartidoJugadorReal[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {}
}

export function JugarTab() {
  const { profile, iniciales } = usePlayerProfile();
  const [selectedCategoria, setSelectedCategoria] = useState<string>('Todos');
  const [partidos, setPartidos] = useState<PartidoJugadorReal[]>([]);
  const [modalOpen, setModalOpen] = useState(false);

  // Formulario de publicación
  const [clubNombre, setClubNombre] = useState('');
  const [canchaNombre, setCanchaNombre] = useState('Cancha 1');
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [horaInicio, setHoraInicio] = useState('19:00');
  const [categoria, setCategoria] = useState('5ta');
  const [faltanJugadores, setFaltanJugadores] = useState(1);
  const [posicionBuscada, setPosicionBuscada] = useState('Cualquiera');
  const [nota, setNota] = useState('');

  // Cargar partidos reales de producción al montar
  useEffect(() => {
    setPartidos(getSavedPartidos());
  }, []);

  // Filtrar partidos reales por categoría
  const partidosFiltrados = partidos.filter(p => {
    if (selectedCategoria === 'Todos') return true;
    return p.categoria === selectedCategoria || p.categoria === 'Abierto';
  });

  function handlePublicar(e: React.FormEvent) {
    e.preventDefault();
    if (!clubNombre.trim()) return;

    const nombreReal = profile.nombre || profile.alias || 'Jugador MatchGo';

    const nuevoPartido: PartidoJugadorReal = {
      id: `partido-real-${Date.now()}`,
      organizadorNombre: nombreReal,
      organizadorAlias: profile.alias || undefined,
      organizadorAvatar: profile.avatar_url || iniciales || 'JG',
      clubNombre: clubNombre.trim(),
      canchaNombre: canchaNombre.trim() || 'Cancha 1',
      fecha,
      horaInicio,
      categoria,
      faltanJugadores,
      posicionBuscada: posicionBuscada !== 'Cualquiera' ? posicionBuscada : undefined,
      nota: nota.trim() || undefined,
      creadoEn: new Date().toISOString(),
    };

    const actualizados = [nuevoPartido, ...partidos];
    setPartidos(actualizados);
    savePartidosToStorage(actualizados);
    setModalOpen(false);

    // Limpiar formulario
    setClubNombre('');
    setNota('');
  }

  function handleUnirmeWhatsApp(p: PartidoJugadorReal) {
    const text = `Hola ${p.organizadorNombre}! Vi tu partido publicado en MatchGo 🎾\nLugar: ${p.clubNombre} (${p.canchaNombre})\nFecha: ${formatFechaReserva(p.fecha)} - ${formatHoraReserva(p.horaInicio)} hs\nCategoría: ${p.categoria}\n¡Me gustaría sumarme a tu partido! 🙌`;
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
  }

  return (
    <div style={{ padding: 16, minHeight: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* ── Cabecera ── */}
      <p style={{ fontSize: 13, color: 'var(--mgp-muted)', marginBottom: 16, lineHeight: 1.5 }}>
        Encontrá gente de tu comunidad para jugar. Podés anotarte a una cancha que ya está reservada o publicar que tenés turno y buscás compañeros.
      </p>

      {/* ── Filtro por Categoría (Estático, sin animación horizontal de pantalla) ── */}
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
        {partidosFiltrados.length === 0 ? (
          /* Empty State real de Producción */
          <div style={{ background: '#ffffff', borderRadius: 20, border: '1.5px solid #E2E8F0', padding: '40px 24px', textAlign: 'center', margin: 'auto 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🤝</div>
            <h3 style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 17, color: '#0B1F4D', margin: '0 0 6px' }}>
              Sin partidos disponibles
            </h3>
            <p style={{ fontSize: 13, color: '#64748B', maxWidth: 300, margin: '0 auto', lineHeight: 1.5 }}>
              Cuando alguien de tu zona publique una cancha y busque jugadores, va a aparecer acá.
            </p>
          </div>
        ) : (
          partidosFiltrados.map(p => (
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
              {/* Organizador Real y Categoría */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {p.organizadorAvatar?.startsWith('http') ? (
                    <div
                      style={{
                        width: 40, height: 40, borderRadius: '50%',
                        backgroundImage: `url(${p.organizadorAvatar})`,
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
                      {p.organizadorAvatar || 'JG'}
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#0B1F4D' }}>
                      {p.organizadorNombre} {p.organizadorAlias ? `(@${p.organizadorAlias})` : ''}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748B', fontWeight: 500 }}>
                      Organizador del partido
                    </div>
                  </div>
                </div>

                <span style={{
                  fontSize: 11, fontWeight: 800,
                  color: '#0B1F4D', background: '#D9F23B',
                  borderRadius: 12, padding: '4px 10px'
                }}>
                  {p.categoria}
                </span>
              </div>

              {/* Detalle del Turno */}
              <div style={{ background: '#F8F9FC', borderRadius: 14, padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0B1F4D' }}>
                  📍 {p.clubNombre} <span style={{ fontWeight: 500, color: '#64748B' }}>({p.canchaNombre})</span>
                </div>
                <div style={{ fontSize: 13, color: '#374151', fontWeight: 600 }}>
                  📅 {formatFechaReserva(p.fecha)} · 🕒 {formatHoraReserva(p.horaInicio)} hs
                </div>
                {p.nota && (
                  <div style={{ fontSize: 12, color: '#64748B', fontStyle: 'italic', marginTop: 4, background: '#ffffff', padding: '6px 10px', borderRadius: 8, border: '1px solid #E2E8F0' }}>
                    "{p.nota}"
                  </div>
                )}
              </div>

              {/* Vacantes y Botón Unirme */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <span style={{
                  fontSize: 12, fontWeight: 700,
                  color: '#16A34A', background: '#F0FDF4',
                  border: '1px solid #BBF7D0', padding: '4px 10px', borderRadius: 20
                }}>
                  ⚡ Busca {p.faltanJugadores} {p.faltanJugadores === 1 ? 'jugador' : 'jugadores'} {p.posicionBuscada ? `(${p.posicionBuscada})` : ''}
                </span>

                <button
                  type="button"
                  onClick={() => handleUnirmeWhatsApp(p)}
                  style={{
                    padding: '10px 18px',
                    borderRadius: 12,
                    border: 'none',
                    background: '#39C54A',
                    color: '#0B1F4D',
                    fontWeight: 800,
                    fontSize: 13,
                    fontFamily: "'Inter', sans-serif",
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    boxShadow: '0 2px 8px rgba(57,197,74,0.3)',
                  }}
                >
                  🎾 Unirme
                </button>
              </div>
            </div>
          ))
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
                onClick={() => setModalOpen(false)}
                style={{ background: '#F1F5F9', border: 'none', borderRadius: 99, width: 32, height: 32, cursor: 'pointer', fontWeight: 700, color: '#64748B' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handlePublicar} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#0B1F4D', display: 'block', marginBottom: 4 }}>Organizador</label>
                <input
                  type="text"
                  disabled
                  value={`${profile.nombre || 'Jugador'} ${profile.alias ? `(@${profile.alias})` : ''}`}
                  style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1.5px solid #E2E8F0', fontSize: 14, background: '#F1F5F9', color: '#64748B' }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: '#0B1F4D', display: 'block', marginBottom: 4 }}>Club / Lugar *</label>
                  <input
                    type="text"
                    required
                    placeholder="Ej: Tucán Pádel Center..."
                    value={clubNombre}
                    onChange={e => setClubNombre(e.target.value)}
                    style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1.5px solid #E2E8F0', fontSize: 14, outline: 'none' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: '#0B1F4D', display: 'block', marginBottom: 4 }}>Cancha</label>
                  <input
                    type="text"
                    placeholder="Ej: Cancha 1, Techada..."
                    value={canchaNombre}
                    onChange={e => setCanchaNombre(e.target.value)}
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
                    value={fecha}
                    onChange={e => setFecha(e.target.value)}
                    style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1.5px solid #E2E8F0', fontSize: 14, outline: 'none' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: '#0B1F4D', display: 'block', marginBottom: 4 }}>Hora inicio *</label>
                  <input
                    type="time"
                    required
                    value={horaInicio}
                    onChange={e => setHoraInicio(e.target.value)}
                    style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1.5px solid #E2E8F0', fontSize: 14, outline: 'none' }}
                  />
                </div>
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
                  <label style={{ fontSize: 12, fontWeight: 700, color: '#0B1F4D', display: 'block', marginBottom: 4 }}>Faltan jugadores</label>
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
                  placeholder="Ej: Buscamos 1 revés 5ª para partido parejo..."
                  value={nota}
                  onChange={e => setNota(e.target.value)}
                  style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1.5px solid #E2E8F0', fontSize: 14, outline: 'none' }}
                />
              </div>

              <button
                type="submit"
                style={{ marginTop: 6, padding: '16px', borderRadius: 14, border: 'none', background: '#39C54A', color: '#0B1F4D', fontWeight: 800, fontSize: 15, cursor: 'pointer', boxShadow: '0 4px 14px rgba(57,197,74,0.3)' }}
              >
                🚀 Publicar en la Comunidad
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
