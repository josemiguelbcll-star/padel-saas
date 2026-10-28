import { useMemo } from 'react';
import { usePlayerProfile } from '../hooks/usePlayerProfile';
import type { MiReservaReal } from '../hooks/useMyReservas';
import { formatFechaReserva, formatHoraReserva } from '../hooks/useMyReservas';
import { FeedCentralSimple } from '../components/FeedCentralSimple';
import { TyTPartnerCard } from '../components/TyTPartnerCard';

interface HomeTabProps {
  onGoReservar:   () => void;
  onGoJugar:      () => void;
  onGoPartidos:   () => void;
  proximaReserva: MiReservaReal | null;
}

export function HomeTab({ onGoJugar, onGoPartidos, proximaReserva }: HomeTabProps) {
  const { profile, isLoading } = usePlayerProfile();

  // Nombre formateado en Capital Case (ej: "marce ifran singh" -> "Marce Ifran Singh")
  const formattedName = useMemo(() => {
    const raw = profile.alias || profile.nombre || '';
    if (!raw.trim()) return 'Jugador';
    return raw
      .trim()
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }, [profile.alias, profile.nombre]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        {/* Shimmer de la tarjeta de saludo */}
        <div
          style={{
            background: 'linear-gradient(135deg, #07152E 0%, #0D234A 100%)',
            borderRadius: 22,
            padding: '22px 20px',
            height: 120,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            opacity: 0.6,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
            <div className="animate-pulse" style={{ width: 120, height: 14, borderRadius: 4, background: 'rgba(255, 255, 255, 0.12)' }} />
            <div className="animate-pulse" style={{ width: 180, height: 22, borderRadius: 6, background: 'rgba(255, 255, 255, 0.2)' }} />
          </div>
          <div className="animate-pulse" style={{ width: 52, height: 52, borderRadius: 18, background: 'rgba(255, 255, 255, 0.15)' }} />
        </div>

        {/* Shimmer del partner */}
        <div className="animate-pulse" style={{ width: '100%', height: 260, borderRadius: 20, background: '#ffffff', border: '1.5px solid #E2E8F0' }} />

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

      {/* ── Greeting Hero Card (Diseño Mejorado & Moderno) ── */}
      <div
        style={{
          background: 'linear-gradient(135deg, #07152E 0%, #0D234A 55%, #15366D 100%)',
          borderRadius: 22,
          padding: '22px 20px',
          color: '#ffffff',
          position: 'relative',
          overflow: 'hidden',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: '0 10px 30px -4px rgba(7, 21, 46, 0.25)',
        }}
      >
        {/* Glows ambientales sutiles */}
        <div
          style={{
            position: 'absolute',
            right: -20,
            top: -20,
            width: 130,
            height: 130,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(57, 197, 74, 0.22) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 20,
            bottom: -30,
            width: 100,
            height: 100,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(217, 242, 59, 0.1) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            position: 'relative',
            zIndex: 1,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                background: 'rgba(57, 197, 74, 0.16)',
                border: '1px solid rgba(57, 197, 74, 0.3)',
                color: '#39C54A',
                fontSize: 10,
                fontWeight: 800,
                padding: '3px 9px',
                borderRadius: 99,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: 8,
              }}
            >
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#39C54A', boxShadow: '0 0 6px #39C54A' }} />
              <span>Comunidad MatchGo</span>
            </div>

            <h2
              style={{
                fontSize: 22,
                fontWeight: 800,
                fontFamily: "'Poppins', sans-serif",
                margin: 0,
                color: '#ffffff',
                letterSpacing: '-0.02em',
                lineHeight: 1.2,
                wordBreak: 'break-word',
              }}
            >
              ¡Hola, {formattedName}! 👋
            </h2>

            <p
              style={{
                fontSize: 13,
                color: 'rgba(255, 255, 255, 0.78)',
                margin: '6px 0 0',
                lineHeight: '1.4',
                fontWeight: 400,
              }}
            >
              Tu portal de pádel: reservas en vivo, torneos y comunidad activa.
            </p>
          </div>

          {/* Avatar o Emblema del Jugador */}
          <div style={{ flexShrink: 0 }}>
            {profile.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={formattedName}
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 18,
                  objectFit: 'cover',
                  border: '2px solid rgba(217, 242, 59, 0.5)',
                  boxShadow: '0 6px 16px rgba(0, 0, 0, 0.3)',
                }}
              />
            ) : (
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 18,
                  background: 'linear-gradient(135deg, rgba(217, 242, 59, 0.2) 0%, rgba(57, 197, 74, 0.22) 100%)',
                  border: '1.5px solid rgba(217, 242, 59, 0.45)',
                  backdropFilter: 'blur(10px)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 6px 20px rgba(0, 0, 0, 0.2)',
                }}
              >
                <span
                  style={{
                    fontFamily: "'Poppins', sans-serif",
                    fontWeight: 800,
                    fontSize: 18,
                    color: '#D9F23B',
                    lineHeight: 1,
                  }}
                >
                  {formattedName.charAt(0).toUpperCase()}
                </span>
                {profile.categoria ? (
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 800,
                      color: 'rgba(255, 255, 255, 0.85)',
                      marginTop: 2,
                      textTransform: 'uppercase',
                      letterSpacing: '0.02em',
                    }}
                  >
                    {profile.categoria}
                  </span>
                ) : (
                  <span
                    style={{
                      fontSize: 8,
                      fontWeight: 700,
                      color: '#39C54A',
                      marginTop: 2,
                      letterSpacing: '0.02em',
                    }}
                  >
                    PADEL
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Próxima reserva confirmada (sólo se muestra si existe un partido activo agendado) ── */}
      {proximaReserva && (
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
      )}

      {/* ── T&T Pádel ── */}
      <div style={{ marginTop: 8 }}>
        <p
          style={{
            fontFamily: "'Poppins', sans-serif",
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--mgp-marino)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            margin: '0 0 12px 2px',
          }}
        >
          T&T Pádel
        </p>
        <TyTPartnerCard />
      </div>

      {/* ── Feed central ── */}
      <div style={{ marginTop: 8 }}>
        <p
          style={{
            fontFamily: "'Poppins', sans-serif",
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--mgp-marino)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            margin: '0 0 12px 2px',
          }}
        >
          Novedades del club
        </p>
        <FeedCentralSimple />
      </div>

    </div>
  );
}
