import { useState } from 'react';
import type { ReactNode } from 'react';
import { usePlayerProfile } from '../hooks/usePlayerProfile';
import { EditPerfilScreen } from './EditPerfilScreen';
import type { MiReservaReal } from '../hooks/useMyReservas';
import { formatFechaReserva, formatHoraReserva, colorEstado, labelEstado } from '../hooks/useMyReservas';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CAT_LABEL: Record<string, string> = {
  '1ra': '1ª categoría', '2da': '2ª categoría', '3ra': '3ª categoría',
  '4ta': '4ª categoría', '5ta': '5ª categoría', '6ta': '6ª categoría',
  '7ta': '7ª categoría', '8va': '8ª categoría', 'libre': 'Libre',
};

function Avatar({ src, iniciales, size = 64 }: { src?: string | null; iniciales: string; size?: number }) {
  if (src) {
    return (
      <div style={{
        width: size, height: size, borderRadius: '50%',
        background: `url(${src}) center/cover`,
        border: '3px solid rgba(255,255,255,0.25)',
        flexShrink: 0,
      }} />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'linear-gradient(135deg, #D9F23B 0%, #39C54A 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 800, fontSize: size * 0.36,
      fontFamily: "'Poppins', sans-serif",
      color: '#0B1F4D', flexShrink: 0,
      boxShadow: '0 4px 14px rgba(57,197,74,0.3)',
      border: '3px solid rgba(255,255,255,0.2)',
    }}>
      {iniciales || '?'}
    </div>
  );
}

function ReservaCard({ r }: { r: MiReservaReal }) {
  const c = colorEstado(r.estado);
  return (
    <div style={{
      background: '#fff', border: '1.5px solid #E2E8F0',
      borderRadius: 16, padding: '16px',
      display: 'flex', gap: 14, alignItems: 'stretch',
    }}>
      <div style={{ width: 4, borderRadius: 99, flexShrink: 0, background: c.text }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div>
            <p style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 15, color: '#0B1F4D', margin: 0 }}>
              {formatFechaReserva(r.fecha)} · {formatHoraReserva(r.hora_inicio)}
            </p>
            <p style={{ fontSize: 13, color: '#64748B', margin: '2px 0 0', fontWeight: 500 }}>
              {r.club_nombre} — {r.cancha_nombre}
            </p>
          </div>
          <span style={{
            fontSize: 11, fontWeight: 700,
            color: c.text, background: c.bg, border: `1px solid ${c.border}`,
            borderRadius: 20, padding: '3px 10px',
            flexShrink: 0, marginLeft: 8,
          }}>
            {labelEstado(r.estado)}
          </span>
        </div>
      </div>
    </div>
  );
}

function HistorialRow({ r }: { r: MiReservaReal }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '13px 0', borderBottom: '1px solid #F1F5F9',
    }}>
      <div>
        <p style={{ fontSize: 14, fontWeight: 600, color: '#1E293B', margin: 0 }}>{r.club_nombre}</p>
        <p style={{ fontSize: 12, color: '#64748B', margin: '2px 0 0' }}>
          {r.cancha_nombre} · {formatFechaReserva(r.fecha)} · {formatHoraReserva(r.hora_inicio)}
        </p>
      </div>
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none"
        stroke="#CBD5E1" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </div>
  );
}

function SettingsRow({ icon, label, onPress }: { icon: ReactNode; label: string; onPress?: () => void }) {
  return (
    <button type="button" onClick={onPress} style={{
      display: 'flex', alignItems: 'center', gap: 14,
      width: '100%', padding: '15px 0',
      background: 'none', border: 'none',
      borderBottom: '1px solid #F1F5F9',
      cursor: 'pointer', textAlign: 'left',
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10, background: '#F1F5F9',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        {icon}
      </div>
      <span style={{ flex: 1, fontSize: 15, fontWeight: 500, color: '#1E293B', fontFamily: "'Inter', sans-serif" }}>
        {label}
      </span>
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none"
        stroke="#CBD5E1" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

interface PerfilTabProps {
  onLogout:         () => void;
  proximas:         MiReservaReal[];
  historial:        MiReservaReal[];
  isLoadingReservas: boolean;
}

export function PerfilTab({ onLogout, proximas, historial, isLoadingReservas }: PerfilTabProps) {
  const { profile, saveProfile, isSaving, iniciales } = usePlayerProfile();
  const [editOpen, setEditOpen] = useState(false);

  // Nombre a mostrar: alias si tiene, sino nombre, sino fallback
  const displayName = profile.alias || profile.nombre || 'Tu nombre';
  const displaySub  = profile.categoria ? CAT_LABEL[profile.categoria] : profile.email || profile.telefono || '';

  return (
    <>
      {/* ── Pantalla de edición (overlay) ── */}
      {editOpen && (
        <EditPerfilScreen
          initial={profile}
          onSave={async (p) => { await saveProfile(p); setEditOpen(false); }}
          onCancel={() => setEditOpen(false)}
          isSaving={isSaving}
        />
      )}

      <div style={{
        height: '100%', overflowY: 'auto',
        background: '#F8F9FC',
        fontFamily: "'Inter', sans-serif",
      }}>

        {/* ── Hero ─────────────────────────────────────────────── */}
        <div style={{
          background: '#0B1F4D',
          padding: '28px 20px 32px',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: 10,
        }}>
          <Avatar src={profile.avatar_url} iniciales={iniciales} size={80} />

          <div style={{ textAlign: 'center' }}>
            <p style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 800, fontSize: 22, color: '#fff', margin: 0 }}>
              {displayName}
            </p>
            {displaySub ? (
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, margin: '4px 0 0' }}>
                {displaySub}
              </p>
            ) : null}
            {profile.telefono && profile.telefono !== displaySub && (
              <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, margin: '2px 0 0' }}>
                {profile.telefono}
              </p>
            )}
          </div>

          {/* Botón editar */}
          <button
            onClick={() => setEditOpen(true)}
            style={{
              marginTop: 4, padding: '9px 22px', borderRadius: 99,
              border: '1.5px solid rgba(255,255,255,0.2)',
              background: 'rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.9)',
              fontSize: 13, fontWeight: 600,
              fontFamily: "'Inter', sans-serif",
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 7,
            }}
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Editar perfil
          </button>
        </div>

        {/* ── Próximas reservas ─────────────────────────────────── */}
        <div style={{ padding: '20px 16px 0' }}>
          <p style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 15, color: '#0B1F4D', margin: '0 0 12px' }}>
            Próximas reservas
          </p>

          {isLoadingReservas ? (
            <div style={{ background: '#fff', borderRadius: 16, border: '1.5px solid #E2E8F0', padding: '28px 20px', textAlign: 'center' }}>
              <p style={{ fontSize: 13, color: '#94A3B8', margin: 0 }}>Cargando...</p>
            </div>
          ) : proximas.length === 0 ? (
            <div style={{
              background: '#fff', borderRadius: 16, border: '1.5px solid #E2E8F0',
              padding: '28px 20px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>📅</div>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#0B1F4D', margin: '0 0 4px' }}>Sin reservas próximas</p>
              <p style={{ fontSize: 13, color: '#64748B', margin: 0 }}>Pedile al club que registre tu número de teléfono al hacer tu reserva</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {proximas.map(r => <ReservaCard key={r.id} r={r} />)}
            </div>
          )}
        </div>

        {/* ── Historial ────────────────────────────────────────── */}
        {!isLoadingReservas && historial.length > 0 && (
          <div style={{ margin: '20px 16px 0', background: '#fff', borderRadius: 16, border: '1.5px solid #E2E8F0', padding: '0 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0 8px' }}>
              <p style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 15, color: '#0B1F4D', margin: 0 }}>Historial</p>
              <span style={{ fontSize: 12, color: '#94A3B8' }}>últimas {historial.length}</span>
            </div>
            {historial.map(h => <HistorialRow key={h.id} r={h} />)}
          </div>
        )}

        {/* ── Ajustes ──────────────────────────────────────────── */}
        <div style={{ margin: '20px 16px 0', background: '#fff', borderRadius: 16, border: '1.5px solid #E2E8F0', padding: '0 16px' }}>
          <SettingsRow icon={
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#0B1F4D" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          } label="Notificaciones" />
          <SettingsRow icon={
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#0B1F4D" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          } label="Ayuda y soporte" />
          <SettingsRow icon={
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#0B1F4D" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          } label="Privacidad" />
        </div>

        {/* ── Cerrar sesión ────────────────────────────────────── */}
        <div style={{ padding: '20px 16px 40px' }}>
          <button type="button" onClick={onLogout} style={{
            width: '100%', padding: '16px', borderRadius: 14,
            border: '1.5px solid #FECACA', background: '#FEF2F2',
            color: '#DC2626', fontSize: 15, fontWeight: 700,
            fontFamily: "'Inter', sans-serif", cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <svg width={17} height={17} viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Cerrar sesión
          </button>
          <p style={{ textAlign: 'center', fontSize: 11, color: '#CBD5E1', marginTop: 20 }}>MatchGo · v1.0.0</p>
        </div>
      </div>
    </>
  );
}
