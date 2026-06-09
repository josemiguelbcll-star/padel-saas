import { usePlayerProfile } from '../hooks/usePlayerProfile';
import type { MiReservaReal } from '../hooks/useMyReservas';
import { formatFechaReserva, formatHoraReserva } from '../hooks/useMyReservas';
import { FeedCentral } from '../components/FeedCentral';

// ── Helpers ───────────────────────────────────────────────────

function getSaludo(): string {
  const h = new Date().getHours();
  if (h >= 6 && h < 12) return 'Buenos días';
  if (h >= 12 && h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

// ── Componente ────────────────────────────────────────────────

interface HomeTabProps {
  onGoReservar:   () => void;
  onGoJugar:      () => void;
  onGoPartidos:   () => void;
  proximaReserva: MiReservaReal | null;
}

export function HomeTab({ onGoReservar, onGoJugar, onGoPartidos, proximaReserva }: HomeTabProps) {
  const { profile } = usePlayerProfile();
  const nombreMostrar = profile.alias || profile.nombre || '';

  return (
    <div style={{ padding: '20px 16px 0' }}>

      {/* ── Greeting ── */}
      <div className="mgp-section">
        <p className="mgp-display-sm" style={{ color: 'var(--mgp-marino)', marginBottom: 2 }}>
          {getSaludo()} 👋
        </p>
        {nombreMostrar && (
          <p className="mgp-muted" style={{ fontSize: 13 }}>{nombreMostrar}</p>
        )}
      </div>

      {/* ── Próxima reserva ── */}
      <div className="mgp-section">
        {proximaReserva ? (
          <div className="mgp-reserva-card">
            <p className="mgp-label" style={{ color: 'rgba(255,255,255,0.6)', marginBottom: 6 }}>
              PRÓXIMA RESERVA
            </p>
            <p className="mgp-reserva-fecha">
              {formatFechaReserva(proximaReserva.fecha)} · {proximaReserva.club_nombre}
            </p>
            <p className="mgp-reserva-hora">{formatHoraReserva(proximaReserva.hora_inicio)}</p>
            <p className="mgp-reserva-club">{proximaReserva.cancha_nombre}</p>
            <div className="mgp-reserva-actions">
              <button
                className="mgp-btn mgp-btn-sm"
                style={{ border: '1.5px solid rgba(255,255,255,0.4)', background: 'transparent', color: '#fff' }}
                onClick={onGoPartidos}
              >
                Ver detalle
              </button>
              <button
                className="mgp-btn mgp-btn-sm"
                style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}
                onClick={onGoJugar}
              >
                Buscar jugadores
              </button>
            </div>
          </div>
        ) : (
          <div style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1.5px solid rgba(255,255,255,0.1)',
            borderRadius: 18, padding: '20px 18px',
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <p className="mgp-label" style={{ color: 'rgba(255,255,255,0.45)', margin: 0 }}>
              SIN PRÓXIMAS RESERVAS
            </p>
            <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13, margin: 0 }}>
              Explorá los clubes y reservá tu cancha 🎾
            </p>
            <button
              className="mgp-btn mgp-btn-primary mgp-btn-sm"
              style={{ alignSelf: 'flex-start' }}
              onClick={onGoReservar}
            >
              Explorar canchas →
            </button>
          </div>
        )}
      </div>

      {/* ── Acceso rápido ── */}
      <div className="mgp-section">
        <div className="mgp-section-title">
          <span className="mgp-section-h">Acceso rápido</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <button
            className="mgp-btn mgp-btn-primary mgp-btn-full"
            style={{ flexDirection: 'column', gap: 4, padding: '14px 8px', borderRadius: 14 }}
            onClick={onGoReservar}
          >
            <span style={{ fontSize: 22 }}>🔍</span>
            <span style={{ fontSize: 12 }}>Reservar</span>
          </button>
          <button
            className="mgp-btn mgp-btn-secondary mgp-btn-full"
            style={{ flexDirection: 'column', gap: 4, padding: '14px 8px', borderRadius: 14 }}
            onClick={onGoJugar}
          >
            <span style={{ fontSize: 22 }}>🤝</span>
            <span style={{ fontSize: 12 }}>Jugar</span>
          </button>
          <button
            className="mgp-btn mgp-btn-marino mgp-btn-full"
            style={{ flexDirection: 'column', gap: 4, padding: '14px 8px', borderRadius: 14 }}
            onClick={onGoPartidos}
          >
            <span style={{ fontSize: 22 }}>📅</span>
            <span style={{ fontSize: 12 }}>Mis canchas</span>
          </button>
        </div>
      </div>

      {/* ── Feed central ── */}
      <div className="mgp-section">
        <div className="mgp-section-title">
          <span className="mgp-section-h">Feed central</span>
        </div>
        <FeedCentral />
      </div>

    </div>
  );
}
