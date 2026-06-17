import { useState } from 'react';
import { Search, Users, Calendar, Trophy } from 'lucide-react';
import { usePlayerProfile } from '../hooks/usePlayerProfile';
import type { MiReservaReal } from '../hooks/useMyReservas';
import { formatFechaReserva, formatHoraReserva } from '../hooks/useMyReservas';
import { FeedCentralSimple } from '../components/FeedCentralSimple';

interface HomeTabProps {
  onGoReservar:   () => void;
  onGoJugar:      () => void;
  onGoPartidos:   () => void;
  proximaReserva: MiReservaReal | null;
}

export function HomeTab({ onGoReservar, onGoJugar, onGoPartidos, proximaReserva }: HomeTabProps) {
  const { profile, isLoading } = usePlayerProfile();
  const nombreMostrar = profile.alias || profile.nombre || '';

  // Hover states for the quick access tiles to maintain smooth CSS transitions inline
  const [hoverTile, setHoverTile] = useState<'reservar' | 'jugar' | 'partidos' | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-6">
        {/* Shimmer de la tarjeta de saludo */}
        <div style={{
          background: 'linear-gradient(135deg, #0B1F4D 0%, #17326D 100%)',
          borderRadius: 20,
          padding: '22px 20px',
          height: 120,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          opacity: 0.6,
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
            <div className="animate-pulse" style={{ width: 120, height: 14, borderRadius: 4, background: 'rgba(255, 255, 255, 0.12)' }} />
            <div className="animate-pulse" style={{ width: 180, height: 22, borderRadius: 6, background: 'rgba(255, 255, 255, 0.2)' }} />
          </div>
          <div className="animate-pulse" style={{ width: 46, height: 46, borderRadius: 14, background: 'rgba(255, 255, 255, 0.15)' }} />
        </div>

        {/* Shimmer del acceso rápido */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {[...Array(3)].map((_, i) => (
            <div key={i} className="animate-pulse" style={{ height: 92, borderRadius: 16, background: '#ffffff', border: '1.5px solid #E2E8F0' }} />
          ))}
        </div>

        {/* Shimmer del feed */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="animate-pulse" style={{ width: 130, height: 16, borderRadius: 4, background: '#E2E8F0' }} />
          <div className="animate-pulse" style={{ width: '100%', height: 180, borderRadius: 20, background: '#ffffff', border: '1.5px solid #E2E8F0' }} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ── Greeting Hero Card ── */}
      <div style={{
        background: 'linear-gradient(135deg, #0B1F4D 0%, #17326D 100%)',
        borderRadius: 20,
        padding: '22px 20px',
        color: '#ffffff',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: '0 8px 30px rgba(11, 31, 77, 0.16)',
      }}>
        <div style={{
          position: 'absolute',
          right: -24,
          top: -24,
          width: 120,
          height: 120,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(217, 242, 59, 0.15) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, position: 'relative', zIndex: 1 }}>
          <div style={{ flex: 1 }}>
            <span style={{
              background: 'rgba(217, 242, 59, 0.2)',
              color: '#D9F23B',
              fontSize: 10,
              fontWeight: 800,
              padding: '3px 8px',
              borderRadius: 99,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              display: 'inline-block',
              marginBottom: 6,
            }}>
              Comunidad MatchGo
            </span>
            <h2 style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Poppins', sans-serif", margin: 0, color: '#ffffff', letterSpacing: '-0.02em' }}>
              {nombreMostrar ? `¡Hola, ${nombreMostrar}! 👋` : '¡Hola jugador! 👋'}
            </h2>
            <p style={{ fontSize: 13, color: 'rgba(255, 255, 255, 0.8)', margin: '6px 0 0', lineHeight: '1.4' }}>
              Reservá canchas, buscá partidos y mantenete conectado con tu club de pádel.
            </p>
          </div>
          <div style={{
            width: 46,
            height: 46,
            borderRadius: 14,
            background: '#D9F23B',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
            boxShadow: '0 4px 12px rgba(217, 242, 59, 0.3)',
          }}>
            <Trophy className="h-5 w-5 text-[#0B1F4D]" strokeWidth={2.5} />
          </div>
        </div>
      </div>

      {/* ── Próxima reserva ── */}
      <div>
        {proximaReserva ? (
          <div className="mgp-reserva-card" style={{ marginBottom: 0 }}>
            <p className="mgp-label" style={{ color: 'rgba(255,255,255,0.6)', marginBottom: 6 }}>
              PRÓXIMA FECHA
            </p>
            <p className="mgp-reserva-fecha">
              {formatFechaReserva(proximaReserva.fecha)} · {proximaReserva.club_nombre}
            </p>
            <p className="mgp-reserva-hora">{formatHoraReserva(proximaReserva.hora_inicio)}</p>
            <p className="mgp-reserva-club">{proximaReserva.cancha_nombre}</p>
            <div className="mgp-reserva-actions">
              <button
                className="mgp-btn mgp-btn-sm"
                style={{ border: '1.5px solid rgba(255,255,255,0.4)', background: 'transparent', color: '#fff', fontWeight: 600 }}
                onClick={onGoPartidos}
              >
                Ver detalle
              </button>
              <button
                className="mgp-btn mgp-btn-sm"
                style={{ background: 'rgba(255,255,255,0.12)', color: '#fff', fontWeight: 600 }}
                onClick={onGoJugar}
              >
                Buscar jugadores
              </button>
            </div>
          </div>
        ) : (
          <div style={{
            background: '#ffffff',
            border: '1px solid var(--mgp-border)',
            borderRadius: 18,
            padding: '20px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
          }}>
            <p style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '0.05em',
              color: 'var(--mgp-muted)',
              margin: 0,
              textTransform: 'uppercase',
            }}>
              Sin reservas activas
            </p>
            <p style={{ color: 'var(--mgp-text-sub)', fontSize: 13, margin: 0, lineHeight: 1.4 }}>
              ¿Listo para entrar a la cancha? Reservá tu turno de forma inmediata.
            </p>
            <button
              className="mgp-btn mgp-btn-primary mgp-btn-sm"
              style={{ alignSelf: 'flex-start', background: 'var(--mgp-marino)', color: '#ffffff', fontWeight: 600, border: 'none', borderRadius: 99, padding: '8px 16px', fontSize: 12 }}
              onClick={onGoReservar}
            >
              Reservar cancha →
            </button>
          </div>
        )}
      </div>

      {/* ── Acceso rápido ── */}
      <div style={{ marginTop: 8 }}>
        <p style={{
          fontFamily: "'Poppins', sans-serif",
          fontSize: 13,
          fontWeight: 700,
          color: 'var(--mgp-marino)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          margin: '0 0 12px 2px',
        }}>
          Acceso rápido
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          <button
            onClick={onGoReservar}
            onMouseEnter={() => setHoverTile('reservar')}
            onMouseLeave={() => setHoverTile(null)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px 12px',
              borderRadius: 16,
              background: '#ffffff',
              border: `1.5px solid ${hoverTile === 'reservar' ? 'var(--mgp-green)' : 'var(--mgp-border)'}`,
              cursor: 'pointer',
              transition: 'all 0.2s ease-in-out',
              gap: 8,
              boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
              transform: hoverTile === 'reservar' ? 'translateY(-2px)' : 'none',
            }}
          >
            <div style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: 'rgba(57, 197, 74, 0.1)',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--mgp-green)',
            }}>
              <Search size={18} strokeWidth={2.5} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--mgp-marino)' }}>Reservar</span>
          </button>

          <button
            onClick={onGoJugar}
            onMouseEnter={() => setHoverTile('jugar')}
            onMouseLeave={() => setHoverTile(null)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px 12px',
              borderRadius: 16,
              background: '#ffffff',
              border: `1.5px solid ${hoverTile === 'jugar' ? 'var(--mgp-green)' : 'var(--mgp-border)'}`,
              cursor: 'pointer',
              transition: 'all 0.2s ease-in-out',
              gap: 8,
              boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
              transform: hoverTile === 'jugar' ? 'translateY(-2px)' : 'none',
            }}
          >
            <div style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: 'rgba(217, 242, 59, 0.15)',
              display: 'grid',
              placeItems: 'center',
              color: '#a0b916',
            }}>
              <Users size={18} strokeWidth={2.5} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--mgp-marino)' }}>Jugar</span>
          </button>

          <button
            onClick={onGoPartidos}
            onMouseEnter={() => setHoverTile('partidos')}
            onMouseLeave={() => setHoverTile(null)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px 12px',
              borderRadius: 16,
              background: '#ffffff',
              border: `1.5px solid ${hoverTile === 'partidos' ? 'var(--mgp-green)' : 'var(--mgp-border)'}`,
              cursor: 'pointer',
              transition: 'all 0.2s ease-in-out',
              gap: 8,
              boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
              transform: hoverTile === 'partidos' ? 'translateY(-2px)' : 'none',
            }}
          >
            <div style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: 'rgba(11, 31, 77, 0.05)',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--mgp-marino)',
            }}>
              <Calendar size={18} strokeWidth={2.5} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--mgp-marino)' }}>Mis canchas</span>
          </button>
        </div>
      </div>

      {/* ── Feed central ── */}
      <div style={{ marginTop: 8 }}>
        <p style={{
          fontFamily: "'Poppins', sans-serif",
          fontSize: 13,
          fontWeight: 700,
          color: 'var(--mgp-marino)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          margin: '0 0 12px 2px',
        }}>
          Novedades del club
        </p>
        <FeedCentralSimple />
      </div>

    </div>
  );
}
