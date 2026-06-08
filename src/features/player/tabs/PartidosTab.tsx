import type { MiReservaReal } from '../hooks/useMyReservas';
import { formatFechaReserva, formatHoraReserva, labelEstado, colorEstado } from '../hooks/useMyReservas';

interface PartidosTabProps {
  proximas:  MiReservaReal[];
  historial: MiReservaReal[];
  isLoading: boolean;
}

function EstadoBadge({ estado }: { estado: string }) {
  const c = colorEstado(estado);
  return (
    <span style={{
      fontSize: 11, fontWeight: 700,
      color: c.text, background: c.bg, border: `1px solid ${c.border}`,
      borderRadius: 20, padding: '3px 10px', flexShrink: 0,
    }}>
      {labelEstado(estado)}
    </span>
  );
}

function ProximaCard({ r }: { r: MiReservaReal }) {
  return (
    <div className="mgp-card" style={{ marginBottom: 0 }}>
      {/* Estado + fecha */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <EstadoBadge estado={r.estado} />
        <span style={{ fontSize: 12, color: 'var(--mgp-muted)' }}>
          {formatFechaReserva(r.fecha)}
        </span>
      </div>

      {/* Hora + lugar */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{
            fontFamily: 'var(--mgp-font-display)',
            fontWeight: 700, fontSize: 28,
            color: 'var(--mgp-marino)', lineHeight: 1,
          }}>
            {formatHoraReserva(r.hora_inicio)}
          </span>
          <span style={{ fontSize: 13, color: 'var(--mgp-muted)' }}>{r.cancha_nombre}</span>
        </div>
        <div style={{ fontSize: 13, color: 'var(--mgp-text-sub)', marginTop: 4 }}>
          📍 {r.club_nombre}
        </div>
      </div>

      {/* Monto */}
      {r.monto_total > 0 && (
        <div style={{ marginBottom: 12, display: 'flex', gap: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--mgp-muted)' }}>
            Total:{' '}
            <span style={{ fontWeight: 700, color: 'var(--mgp-marino)' }}>
              ${r.monto_total.toLocaleString('es-AR')}
            </span>
          </div>
          {r.monto_pagado > 0 && r.monto_pagado < r.monto_total && (
            <div style={{ fontSize: 12, color: 'var(--mgp-muted)' }}>
              Pagado:{' '}
              <span style={{ fontWeight: 600, color: '#39C54A' }}>
                ${r.monto_pagado.toLocaleString('es-AR')}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Acción */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="mgp-btn mgp-btn-outline mgp-btn-sm" style={{ flex: 1 }}>
          Ver detalle
        </button>
      </div>
    </div>
  );
}

function HistorialRow({ r }: { r: MiReservaReal }) {
  const c = colorEstado(r.estado);
  return (
    <div className="mgp-feed-item">
      <div
        className="mgp-feed-dot"
        style={{
          background: r.estado === 'jugada' || r.estado === 'pagada'
            ? 'var(--mgp-success)' : 'var(--mgp-muted)',
          marginTop: 5,
        }}
      />
      <div className="mgp-feed-text">
        <strong>{r.club_nombre}</strong> · {r.cancha_nombre}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div className="mgp-feed-time">{formatFechaReserva(r.fecha)}</div>
        <div style={{ fontSize: 11, color: c.text }}>{labelEstado(r.estado)}</div>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {[1, 2].map(i => (
        <div key={i} style={{
          height: 140, borderRadius: 16,
          background: 'linear-gradient(90deg, #F1F5F9 25%, #E2E8F0 50%, #F1F5F9 75%)',
          backgroundSize: '200% 100%',
          animation: 'mgp-shimmer 1.5s infinite',
        }} />
      ))}
    </div>
  );
}

export function PartidosTab({ proximas, historial, isLoading }: PartidosTabProps) {
  return (
    <div style={{ padding: 16 }}>

      {/* ── Próximas reservas ─────────────────────────────────── */}
      <div className="mgp-section">
        <div className="mgp-section-title">
          <span className="mgp-section-h">Mis próximas canchas</span>
        </div>

        {isLoading ? (
          <LoadingSkeleton />
        ) : proximas.length === 0 ? (
          <div className="mgp-empty-state" style={{ padding: '32px 24px' }}>
            <div className="mgp-empty-state-icon">📅</div>
            <div className="mgp-empty-state-title">Sin reservas próximas</div>
            <div className="mgp-empty-state-sub">
              Reservá una cancha desde el tab Reservar, o pedile al club que registre tu número de teléfono.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {proximas.map(r => <ProximaCard key={r.id} r={r} />)}
          </div>
        )}
      </div>

      {/* ── Historial ─────────────────────────────────────────── */}
      {!isLoading && historial.length > 0 && (
        <div className="mgp-section" style={{ marginTop: 8 }}>
          <div className="mgp-section-title">
            <span className="mgp-section-h">Historial</span>
            <span className="mgp-section-hint">últimas {historial.length}</span>
          </div>

          <div className="mgp-card" style={{ padding: '4px 16px' }}>
            {historial.map(r => <HistorialRow key={r.id} r={r} />)}
          </div>
        </div>
      )}

    </div>
  );
}
