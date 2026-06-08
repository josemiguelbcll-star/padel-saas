import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { PlayerProfile, Categoria, Genero } from '../hooks/usePlayerProfile';
import { esTelefonoValido, errorTelefono } from '../utils/telefonoArg';

const CATEGORIAS: { id: Categoria; label: string }[] = [
  { id: '1ra', label: '1ª' }, { id: '2da', label: '2ª' },
  { id: '3ra', label: '3ª' }, { id: '4ta', label: '4ª' },
  { id: '5ta', label: '5ª' }, { id: '6ta', label: '6ª' },
  { id: '7ta', label: '7ª' }, { id: '8va', label: '8ª' },
  { id: 'libre', label: 'Libre' },
];

const GENEROS: { id: Genero; label: string; icon: string }[] = [
  { id: 'masculino',     label: 'Masculino',    icon: '♂' },
  { id: 'femenino',      label: 'Femenino',     icon: '♀' },
  { id: 'no_especifica', label: 'No especifica', icon: '—' },
];

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
      textTransform: 'uppercase', color: '#0B1F4D', margin: '0 0 8px',
    }}>{children}</p>
  );
}

function TextInput({ value, onChange, placeholder, type = 'text', disabled }: {
  value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; disabled?: boolean;
}) {
  return (
    <input
      type={type} value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder} disabled={disabled}
      style={{
        width: '100%', padding: '15px 16px', borderRadius: 12,
        border: `1.5px solid ${value ? '#39C54A' : '#E2E8F0'}`,
        background: disabled ? '#F1F5F9' : value ? '#F0FDF4' : '#F8F9FC',
        fontSize: 16, fontWeight: value ? 600 : 400,
        fontFamily: "'Inter', sans-serif",
        color: disabled ? '#94A3B8' : '#0B1F4D',
        outline: 'none', boxSizing: 'border-box',
        cursor: disabled ? 'not-allowed' : 'text',
      }}
    />
  );
}

interface EditPerfilScreenProps {
  initial:  PlayerProfile;
  onSave:   (p: PlayerProfile) => Promise<void>;
  onCancel: () => void;
  isSaving: boolean;
}

export function EditPerfilScreen({ initial, onSave, onCancel, isSaving }: EditPerfilScreenProps) {
  const [form,      setForm]      = useState<PlayerProfile>(initial);
  const [saveError, setSaveError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function set<K extends keyof PlayerProfile>(k: K, v: PlayerProfile[K]) {
    setForm(prev => ({ ...prev, [k]: v }));
  }

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const r = ev.target?.result;
      if (typeof r === 'string') set('avatar_url', r);
    };
    reader.readAsDataURL(file);
  }

  async function handleSave() {
    setSaveError(null);
    try { await onSave(form); }
    catch { setSaveError('No se pudo guardar. Revisá tu conexión e intentá de nuevo.'); }
  }

  const iniciales = (form.alias || form.nombre)
    .trim().split(' ').slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '').join('') || '?';

  // Teléfono: obligatorio y debe ser formato argentino válido
  const telError = errorTelefono(form.telefono);
  const canSave  = form.nombre.trim().length >= 2
                && form.telefono.trim() !== ''
                && esTelefonoValido(form.telefono);

  /*
   * ARQUITECTURA DEL OVERLAY
   * ========================
   * createPortal → se renderiza en document.body, FUERA de .mg-player.
   * Evita que overflow:hidden y los listeners de .mgp-content bloqueen
   * el scroll y los eventos de toque.
   *
   * Estructura (flex-column, altura total = 100dvh):
   *
   *  ┌─────────────────────────────────────────┐  ← safe-area-inset-top (navy)
   *  ├─────────────────────────────────────────┤
   *  │  ✕          Editar perfil               │  ← top bar fijo  (56px, navy)
   *  ├─────────────────────────────────────────┤
   *  │                                         │
   *  │         foto + formulario               │  ← scroll zone (flex:1, min-height:0)
   *  │                                         │
   *  ├─────────────────────────────────────────┤
   *  │      Cancelar    |    Guardar cambios   │  ← bottom bar fijo (blanco)
   *  ├─────────────────────────────────────────┤
   *  └─────────────────────────────────────────┘  ← safe-area-inset-bottom (blanco)
   */
  const content = (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      fontFamily: "'Inter', sans-serif",
    }}>

      {/* Fondo navy en la zona del notch/status-bar */}
      <div style={{ flexShrink: 0, background: '#0B1F4D', height: 'env(safe-area-inset-top, 0px)' }} />

      {/* Top bar ──────────────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0, height: 56,
        background: '#0B1F4D',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
      }}>
        {/* Botón cerrar (izquierda) */}
        <button
          onClick={onCancel}
          style={{
            position: 'absolute', left: 16,
            background: 'rgba(255,255,255,0.12)',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 99, padding: '7px 14px',
            color: '#fff', fontSize: 14, fontWeight: 600,
            fontFamily: "'Inter', sans-serif", cursor: 'pointer',
          }}
        >
          Cancelar
        </button>

        <span style={{
          color: '#fff', fontFamily: "'Poppins', sans-serif",
          fontWeight: 700, fontSize: 16,
        }}>
          Editar perfil
        </span>

        {/* Botón guardar (derecha) — en el top bar, visible siempre */}
        <button
          onClick={handleSave}
          disabled={!canSave || isSaving}
          style={{
            position: 'absolute', right: 16,
            background: canSave && !isSaving ? '#39C54A' : 'rgba(255,255,255,0.12)',
            border: 'none',
            borderRadius: 99, padding: '8px 16px',
            color: canSave && !isSaving ? '#0B1F4D' : 'rgba(255,255,255,0.35)',
            fontSize: 14, fontWeight: 800,
            fontFamily: "'Inter', sans-serif",
            cursor: canSave && !isSaving ? 'pointer' : 'default',
            transition: 'background 0.2s, color 0.2s',
            minWidth: 80, textAlign: 'center',
          }}
        >
          {isSaving ? '...' : 'Guardar'}
        </button>
      </div>

      {/* Zona desplazable ─────────────────────────────────────────────────── */}
      <div style={{
        flex: 1,
        minHeight: 0,           /* OBLIGATORIO: permite shrinkear el flex-item */
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        overscrollBehavior: 'contain',
        background: '#F8F9FC',
      }}>

        {/* Error inline (si lo hay) */}
        {saveError && (
          <div style={{
            background: '#FEF2F2', borderBottom: '1px solid #FECACA',
            padding: '10px 20px',
            fontSize: 13, color: '#DC2626',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth={2.5}
              strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {saveError}
          </div>
        )}

        {/* Avatar */}
        <div style={{
          background: '#0B1F4D', paddingBottom: 28,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        }}>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{ position: 'relative', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            <div style={{
              width: 88, height: 88, borderRadius: '50%',
              background: form.avatar_url
                ? `url(${form.avatar_url}) center/cover`
                : 'linear-gradient(135deg, #D9F23B 0%, #39C54A 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, fontSize: 32,
              fontFamily: "'Poppins', sans-serif", color: '#0B1F4D',
              border: '3px solid rgba(255,255,255,0.2)',
            }}>
              {!form.avatar_url && iniciales}
            </div>
            <div style={{
              position: 'absolute', bottom: 2, right: 2,
              width: 28, height: 28, borderRadius: '50%',
              background: '#39C54A',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '2px solid #0B1F4D',
            }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
                stroke="#0B1F4D" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </div>
          </button>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, margin: 0 }}>
            Tocá para cambiar la foto
          </p>
          <input ref={fileInputRef} type="file" accept="image/*" capture="user"
            style={{ display: 'none' }} onChange={handleAvatarChange} />
        </div>

        {/* Formulario */}
        <div style={{ padding: '24px 20px 40px', display: 'flex', flexDirection: 'column', gap: 22 }}>

          <div>
            <FieldLabel>Nombre completo *</FieldLabel>
            <TextInput value={form.nombre} onChange={v => set('nombre', v)} placeholder="Ej: José Miguel Benítez" />
          </div>

          <div>
            <FieldLabel>Alias en la cancha</FieldLabel>
            <TextInput value={form.alias} onChange={v => set('alias', v)} placeholder="Ej: Pepe, Miguelón, JM…" />
            <p style={{ fontSize: 12, color: '#94A3B8', marginTop: 6 }}>Así te van a ver los otros jugadores</p>
          </div>

          <div>
            <FieldLabel>
              Teléfono celular *
              <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 400, color: '#94A3B8', textTransform: 'none', letterSpacing: 0 }}>
                (para WhatsApp)
              </span>
            </FieldLabel>
            <TextInput
              type="tel"
              value={form.telefono}
              onChange={v => set('telefono', v)}
              placeholder="Ej: 3874211234 o 01141234567"
            />
            {telError ? (
              <p style={{ fontSize: 12, color: '#DC2626', marginTop: 6, lineHeight: 1.4 }}>{telError}</p>
            ) : (
              <p style={{ fontSize: 12, color: '#94A3B8', marginTop: 6 }}>
                Código de área + número, sin espacios ni guiones. Requerido para ver tus reservas en la app.
              </p>
            )}
          </div>

          <div>
            <FieldLabel>Email</FieldLabel>
            <TextInput type="email" value={form.email} onChange={() => {}} placeholder="tu@email.com" disabled />
            <p style={{ fontSize: 12, color: '#94A3B8', marginTop: 6 }}>Para cambiar el email contactá al soporte</p>
          </div>

          <div>
            <FieldLabel>Categoría</FieldLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {CATEGORIAS.map(cat => {
                const sel = form.categoria === cat.id;
                return (
                  <button key={cat.id} type="button"
                    onClick={() => set('categoria', sel ? '' : cat.id)}
                    style={{
                      padding: '10px 0', width: 56, borderRadius: 12,
                      border: `2px solid ${sel ? '#39C54A' : '#E2E8F0'}`,
                      background: sel ? '#39C54A' : '#fff',
                      color: sel ? '#0B1F4D' : '#374151',
                      fontSize: 14, fontWeight: sel ? 800 : 500,
                      cursor: 'pointer', fontFamily: "'Inter', sans-serif",
                      transition: 'all 0.15s', textAlign: 'center',
                    }}>
                    {cat.label}
                  </button>
                );
              })}
            </div>
            <p style={{ fontSize: 12, color: '#94A3B8', marginTop: 8 }}>1ª = nivel profesional · 8ª = principiante</p>
          </div>

          <div>
            <FieldLabel>Género</FieldLabel>
            <div style={{ display: 'flex', gap: 8 }}>
              {GENEROS.map(g => {
                const sel = form.genero === g.id;
                return (
                  <button key={g.id} type="button"
                    onClick={() => set('genero', sel ? '' : g.id)}
                    style={{
                      flex: 1, padding: '12px 8px', borderRadius: 12,
                      border: `2px solid ${sel ? '#0B1F4D' : '#E2E8F0'}`,
                      background: sel ? '#0B1F4D' : '#fff',
                      color: sel ? '#fff' : '#374151',
                      fontSize: 13, fontWeight: sel ? 700 : 500,
                      cursor: 'pointer', fontFamily: "'Inter', sans-serif",
                      transition: 'all 0.15s',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    }}>
                    <span style={{ fontSize: 18 }}>{g.icon}</span>
                    <span style={{ fontSize: 11 }}>{g.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{
            background: '#EFF6FF', border: '1px solid #BFDBFE',
            borderRadius: 12, padding: '12px 14px',
            display: 'flex', gap: 10, alignItems: 'flex-start',
          }}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none"
              stroke="#2563EB" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
              style={{ flexShrink: 0, marginTop: 1 }}>
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <p style={{ fontSize: 12, color: '#1D4ED8', margin: 0, lineHeight: 1.5 }}>
              Tus datos solo se comparten con los clubes donde hacés reservas.
            </p>
          </div>

        </div>
      </div>

      {/* Fondo blanco en la zona del home indicator (safe area inferior) */}
      <div style={{ flexShrink: 0, background: '#fff', height: 'env(safe-area-inset-bottom, 0px)' }} />

    </div>
  );

  return createPortal(content, document.body);
}
