import { useState } from 'react';
import type { CompleteOnboardingData } from '../hooks/usePlayerSession';
import { esTelefonoValido, errorTelefono } from '../utils/telefonoArg';

interface PlayerOnboardingProps {
  onComplete: (data: CompleteOnboardingData) => Promise<void>;
}

export function PlayerOnboarding({ onComplete }: PlayerOnboardingProps) {
  const [step,         setStep]         = useState<1 | 2>(1);
  const [nombre,       setNombre]       = useState('');
  const [telefono,     setTelefono]     = useState('');
  const [isCompleting, setIsCompleting] = useState(false);
  const [saveError,    setSaveError]    = useState<string | null>(null);

  const telError = errorTelefono(telefono);
  const canNext  = nombre.trim().length >= 2
                && telefono.trim() !== ''
                && esTelefonoValido(telefono);

  async function handleComplete() {
    if (isCompleting) return;
    setIsCompleting(true);
    setSaveError(null);
    try {
      await onComplete({ nombre, telefono });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Error al guardar. Intentá de nuevo.');
    } finally {
      setIsCompleting(false);
    }
  }

  // ─── Step 1: Datos básicos ──────────────────────────────────────────────────
  if (step === 1) {
    return (
      <div style={{
        width: '100%', minHeight: '100dvh',
        background: '#ffffff',
        display: 'flex', flexDirection: 'column',
        fontFamily: "'Inter', sans-serif",
        boxSizing: 'border-box',
      }}>

        {/* Header navy */}
        <div style={{
          background: '#0B1F4D',
          padding: '28px 24px 32px',
          flexShrink: 0,
        }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 28 }}>
            <div style={{
              width: 34, height: 34,
              background: '#39C54A',
              borderRadius: 9,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 17, fontWeight: 800, color: '#0B1F4D',
              fontFamily: "'Poppins', sans-serif",
            }}>
              M
            </div>
            <span style={{ color: '#fff', fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 19 }}>
              MatchGo
            </span>
          </div>

          <h1 style={{
            fontFamily: "'Poppins', sans-serif",
            fontWeight: 800, fontSize: 28,
            color: '#ffffff', margin: 0,
            lineHeight: 1.2,
          }}>
            ¿Cómo te<br />llamás?
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, marginTop: 8, marginBottom: 0 }}>
            El club lo va a ver cuando hagás una reserva
          </p>
        </div>

        {/* Formulario */}
        <div style={{ flex: 1, padding: '32px 24px 160px', overflowY: 'auto' }}>

          {/* Nombre */}
          <p style={{
            fontSize: 11, fontWeight: 700,
            color: '#0B1F4D', textTransform: 'uppercase',
            letterSpacing: '0.08em', marginBottom: 10,
          }}>
            Tu nombre
          </p>
          <input
            type="text"
            placeholder="Ej: José Miguel"
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            autoFocus
            style={{
              width: '100%', padding: '17px 16px',
              borderRadius: 14,
              border: `2px solid ${nombre ? '#39C54A' : '#E2E8F0'}`,
              background: nombre ? '#F0FDF4' : '#F8F9FC',
              fontSize: 18, fontWeight: 600,
              fontFamily: "'Inter', sans-serif",
              color: '#0B1F4D',
              outline: 'none',
              boxSizing: 'border-box',
              marginBottom: 28,
              transition: 'border-color 0.2s, background 0.2s',
            }}
          />

          {/* Teléfono */}
          <p style={{
            fontSize: 11, fontWeight: 700,
            color: '#0B1F4D', textTransform: 'uppercase',
            letterSpacing: '0.08em', marginBottom: 10,
          }}>
            Teléfono celular *
          </p>
          <input
            type="tel"
            placeholder="Ej: 3874211234 o 01141234567"
            value={telefono}
            onChange={e => setTelefono(e.target.value)}
            style={{
              width: '100%', padding: '17px 16px',
              borderRadius: 14,
              border: `2px solid ${
                telefono && telError  ? '#DC2626'
                : telefono && !telError ? '#39C54A'
                : '#E2E8F0'
              }`,
              background: telefono && telError  ? '#FEF2F2'
                        : telefono && !telError ? '#F0FDF4'
                        : '#F8F9FC',
              fontSize: 17, fontWeight: 500,
              fontFamily: "'Inter', sans-serif",
              color: '#0B1F4D',
              outline: 'none',
              boxSizing: 'border-box',
              transition: 'border-color 0.2s, background 0.2s',
            }}
          />
          {telError ? (
            <p style={{ fontSize: 12, color: '#DC2626', marginTop: 8, lineHeight: 1.4 }}>
              {telError}
            </p>
          ) : (
            <p style={{ fontSize: 12, color: '#94A3B8', marginTop: 8 }}>
              Código de área + número, sin espacios. Ej: 3874211234 (Salta) · 01141234567 (Buenos Aires)
            </p>
          )}
        </div>

        {/* Botón fijo */}
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          padding: '16px 24px 44px',
          background: 'linear-gradient(to bottom, rgba(255,255,255,0) 0%, #ffffff 28%)',
        }}>
          <button
            onClick={() => setStep(2)}
            disabled={!canNext}
            style={{
              width: '100%', padding: '18px',
              borderRadius: 14, border: 'none',
              background: canNext ? '#0B1F4D' : '#E2E8F0',
              color: canNext ? '#ffffff' : '#94A3B8',
              fontSize: 16, fontWeight: 700,
              fontFamily: "'Inter', sans-serif",
              cursor: canNext ? 'pointer' : 'default',
              transition: 'background 0.2s, color 0.2s',
              letterSpacing: '0.01em',
            }}
          >
            Continuar →
          </button>
        </div>
      </div>
    );
  }

  // ─── Step 2: Bienvenida ─────────────────────────────────────────────────────
  return (
    <div style={{
      width: '100%', minHeight: '100dvh',
      background: '#0B1F4D',
      display: 'flex', flexDirection: 'column',
      fontFamily: "'Inter', sans-serif",
      boxSizing: 'border-box',
    }}>

      {/* Logo en blanco */}
      <div style={{ padding: '28px 24px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 34, height: 34,
            background: '#39C54A', borderRadius: 9,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 17, fontWeight: 800, color: '#0B1F4D',
            fontFamily: "'Poppins', sans-serif",
          }}>
            M
          </div>
          <span style={{ color: '#fff', fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 19 }}>
            MatchGo
          </span>
        </div>
      </div>

      {/* Contenido central */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        justifyContent: 'center', alignItems: 'center',
        padding: '0 24px 40px',
        textAlign: 'center',
      }}>

        {/* Ícono verde grande */}
        <div style={{
          width: 96, height: 96, borderRadius: '50%',
          background: '#39C54A',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 28,
          boxShadow: '0 0 0 16px rgba(57,197,74,0.12), 0 0 0 32px rgba(57,197,74,0.06)',
        }}>
          <svg width={48} height={48} viewBox="0 0 24 24" fill="none"
            stroke="#0B1F4D" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>

        <h2 style={{
          fontFamily: "'Poppins', sans-serif",
          fontWeight: 800, fontSize: 30,
          color: '#ffffff', margin: '0 0 10px',
          lineHeight: 1.15,
        }}>
          ¡Hola,<br />{nombre}! 👋
        </h2>
        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 15, margin: '0 0 40px' }}>
          Ya podés reservar canchas en los clubes de Salta
        </p>

        {/* Feature cards */}
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            {
              icon: (
                <svg width={22} height={22} viewBox="0 0 24 24" fill="none"
                  stroke="#39C54A" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              ),
              title: 'Explorá canchas',
              desc:  'Todos los clubes disponibles, con sus horarios',
            },
            {
              icon: (
                <svg width={22} height={22} viewBox="0 0 24 24" fill="none"
                  stroke="#39C54A" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              ),
              title: 'Reservá al toque',
              desc:  'Elegí turno y confirmá en segundos',
            },
            {
              icon: (
                <svg width={22} height={22} viewBox="0 0 24 24" fill="none"
                  stroke="#39C54A" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              ),
              title: 'Encontrá partido',
              desc:  'Jugá con otros cuando tu grupo no llega',
            },
          ].map(item => (
            <div key={item.title} style={{
              background: 'rgba(255,255,255,0.07)',
              border: '1.5px solid rgba(255,255,255,0.1)',
              borderRadius: 16,
              padding: '16px',
              display: 'flex', alignItems: 'center', gap: 14,
              textAlign: 'left',
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: 'rgba(57,197,74,0.12)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                {item.icon}
              </div>
              <div>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#fff', margin: '0 0 2px' }}>
                  {item.title}
                </p>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', margin: 0 }}>
                  {item.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Botón fijo */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        padding: '16px 24px 44px',
        background: 'linear-gradient(to bottom, rgba(11,31,77,0) 0%, #0B1F4D 28%)',
      }}>
        {saveError && (
          <p style={{
            fontSize: 13, color: '#FCA5A5', textAlign: 'center',
            marginBottom: 10, fontWeight: 600,
          }}>
            ⚠️ {saveError}
          </p>
        )}
        <button
          onClick={handleComplete}
          disabled={isCompleting}
          style={{
            width: '100%', padding: '18px',
            borderRadius: 14, border: 'none',
            background: isCompleting ? '#2da33a' : '#39C54A',
            color: '#0B1F4D',
            fontSize: 17, fontWeight: 800,
            fontFamily: "'Inter', sans-serif",
            cursor: isCompleting ? 'default' : 'pointer',
            boxShadow: '0 4px 20px rgba(57,197,74,0.4)',
            letterSpacing: '0.01em',
            transition: 'background 0.2s',
          }}
        >
          {isCompleting ? 'Guardando...' : '¡Empezar a reservar! →'}
        </button>
      </div>
    </div>
  );
}
