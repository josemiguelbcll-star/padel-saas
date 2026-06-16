import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/network';

interface PlayerLoginPageProps {
  /** @deprecated — no-op; la transición la maneja onAuthStateChange */
  onLogin: () => void;
}

export function PlayerLoginPage({ onLogin: _onLogin }: PlayerLoginPageProps) {
  const [mode,            setMode]            = useState<'login' | 'register' | 'recover'>('login');
  const [email,           setEmail]           = useState('');
  const [password,        setPassword]        = useState('');
  const [showPassword,    setShowPassword]    = useState(false);
  const [isLoading,       setIsLoading]       = useState(false);
  const [error,           setError]           = useState<string | null>(null);
  const [registerSuccess, setRegisterSuccess] = useState(false);

  // Estados para recuperación
  const [recoveryEmail,   setRecoveryEmail]   = useState('');
  const [recoverySent,    setRecoverySent]    = useState(false);

  function translateError(msg: string): string {
    if (msg.includes('Invalid login credentials'))  return 'Email o contraseña incorrectos';
    if (msg.includes('Email not confirmed'))        return 'Confirmá tu email antes de ingresar';
    if (msg.includes('User already registered'))    return 'Ya existe una cuenta con ese email. Iniciá sesión.';
    if (msg.includes('Password should be'))         return 'La contraseña debe tener al menos 6 caracteres';
    if (msg.includes('Unable to validate email'))   return 'Email inválido';
    if (msg.includes('signup_disabled'))            return 'El registro está deshabilitado temporalmente';
    return msg;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      if (mode === 'login') {
        const { error } = await withTimeout(
          supabase.auth.signInWithPassword({ email, password }),
          8000,
          'player-login',
        );
        if (error) throw error;
      } else {
        const { error } = await withTimeout(
          supabase.auth.signUp({ email, password }),
          8000,
          'player-register',
        );
        if (error) throw error;
        setRegisterSuccess(true);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error inesperado';
      setError(translateError(msg));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRecoverySubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    const emailTrimmed = recoveryEmail.trim();
    if (!emailTrimmed) {
      setError('Ingresá tu email.');
      setIsLoading(false);
      return;
    }

    try {
      const { error } = await withTimeout(
        supabase.auth.resetPasswordForEmail(emailTrimmed, {
          redirectTo: `${window.location.origin}/reset-password?type=player`,
        }),
        8000,
        'player-reset-password',
      );
      if (error) throw error;
      setRecoverySent(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error inesperado';
      setError(translateError(msg));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options:  { redirectTo: `${window.location.origin}/player` },
    });
    if (error) setError(translateError(error.message));
  }

  // ── Pantalla post-registro: "revisá tu email" ─────────────────────────────
  if (registerSuccess) {
    return (
      <div className="mgp-auth" style={{ background: '#0B1F4D' }}>
        <div className="mgp-auth-card" style={{ textAlign: 'center', maxWidth: 320 }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: '#39C54A',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 24px',
            boxShadow: '0 0 0 12px rgba(57,197,74,0.12)',
          }}>
            <svg width={34} height={34} viewBox="0 0 24 24" fill="none"
              stroke="#0B1F4D" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
          </div>

          <h2 style={{
            fontFamily: "'Poppins', sans-serif", fontWeight: 800,
            fontSize: 26, color: '#fff', margin: '0 0 12px',
          }}>
            Revisá tu email
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 15, lineHeight: 1.55, margin: '0 0 28px' }}>
            Te enviamos un link de confirmación a{' '}
            <strong style={{ color: '#fff' }}>{email}</strong>.
            <br />Hacé click en el link para activar tu cuenta.
          </p>

          <button
            type="button"
            onClick={() => { setRegisterSuccess(false); setMode('login'); setPassword(''); }}
            style={{
              padding: '14px 32px', borderRadius: 12, border: 'none',
              background: '#39C54A', color: '#0B1F4D',
              fontSize: 15, fontWeight: 700,
              fontFamily: "'Inter', sans-serif", cursor: 'pointer',
            }}
          >
            Ir al login
          </button>
        </div>
      </div>
    );
  }

  // ── Pantalla principal de login / registro ─────────────────────────────────
  return (
    <div className="mgp-auth" style={{ background: '#F0F4F8' }}>
      <div className="mgp-auth-card" style={{
        width: '100%', maxWidth: 380,
        background: '#ffffff', borderRadius: 24,
        padding: 32,
        boxShadow: '0 4px 24px rgba(11,31,77,0.10)',
        boxSizing: 'border-box',
      }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div className="mgp-auth-logo">MatchGo</div>
          <div className="mgp-auth-sub">El pádel de Salta en tu bolsillo</div>
        </div>

        {/* Error banner */}
        {error && (
          <div style={{
            background: '#FEF2F2', border: '1px solid #FECACA',
            borderRadius: 10, padding: '11px 14px', marginBottom: 16,
            fontSize: 13, color: '#DC2626',
            display: 'flex', alignItems: 'flex-start', gap: 8,
          }}>
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
              style={{ flexShrink: 0, marginTop: 1 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {error}
          </div>
        )}

        {mode !== 'recover' ? (
          <>
            <form onSubmit={handleSubmit}>
              <input
                className="mgp-input"
                type="email"
                placeholder="tu@email.com"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(null); }}
                autoComplete="email"
                required
                disabled={isLoading}
              />

              <div className="mgp-password-field">
                <input
                  className="mgp-input mgp-input-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Contraseña"
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(null); }}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                  disabled={isLoading}
                />
                <button
                  type="button"
                  className="mgp-password-toggle"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.05 10.05 0 0 1 12 20c-5.52 0-10-4.48-10-10 0-2.1.63-4.04 1.71-5.66" />
                      <path d="M1 1l22 22" />
                      <path d="M9.88 9.88A3 3 0 0 0 14.12 14.12" />
                      <path d="M12 6a9.77 9.77 0 0 1 6.65 2.47" />
                    </svg>
                  ) : (
                    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>

              {mode === 'login' && (
                <div style={{ textAlign: 'right', marginTop: -8, marginBottom: 16 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('recover');
                      setError(null);
                      setRecoverySent(false);
                      setRecoveryEmail(email);
                    }}
                    style={{
                      background: 'none', border: 'none',
                      color: '#64748B', fontSize: 12,
                      cursor: 'pointer', textDecoration: 'underline',
                      padding: 0, fontFamily: 'inherit',
                    }}
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                </div>
              )}

              <button
                type="submit"
                className="mgp-btn mgp-btn-primary mgp-btn-full"
                style={{ marginTop: 4 }}
                disabled={isLoading}
              >
                {isLoading
                  ? (mode === 'login' ? 'Entrando...' : 'Creando cuenta...')
                  : (mode === 'login' ? 'Entrar' : 'Crear cuenta')
                }
              </button>
            </form>

            {/* Divisor */}
            <div className="mgp-divider">o</div>

            {/* Google OAuth */}
            <button
              type="button"
              className="mgp-btn mgp-btn-outline mgp-btn-full"
              onClick={handleGoogle}
              disabled={isLoading}
            >
              <svg width={18} height={18} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Continuar con Google
            </button>

            {/* Toggle login / registro */}
            <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: '#64748B' }}>
              {mode === 'login' ? '¿Primera vez?' : '¿Ya tenés cuenta?'}{' '}
              <button
                type="button"
                onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}
                style={{
                  background: 'none', border: 'none',
                  color: '#0B1F4D', fontWeight: 600,
                  fontSize: 13, cursor: 'pointer',
                  padding: 0, fontFamily: 'inherit',
                }}
              >
                {mode === 'login' ? 'Creá tu cuenta' : 'Iniciá sesión'}
              </button>
            </p>
          </>
        ) : (
          <form onSubmit={handleRecoverySubmit}>
            {recoverySent ? (
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  background: '#ECFDF5', border: '1px solid #A7F3D0',
                  borderRadius: 12, padding: '16px', marginBottom: 20,
                  fontSize: 14, color: '#065F46', lineHeight: 1.5,
                }}>
                  Te enviamos un email a <strong>{recoveryEmail}</strong> con las instrucciones para recuperar tu contraseña.
                </div>
                <button
                  type="button"
                  className="mgp-btn mgp-btn-primary mgp-btn-full"
                  onClick={() => { setMode('login'); setRecoverySent(false); }}
                >
                  Volver al login
                </button>
              </div>
            ) : (
              <>
                <p style={{ fontSize: 14, color: '#64748B', marginBottom: 16, lineHeight: 1.4 }}>
                  Ingresá tu email y te enviaremos un link para reponer tu clave.
                </p>

                <input
                  className="mgp-input"
                  type="email"
                  placeholder="tu@email.com"
                  value={recoveryEmail}
                  onChange={e => { setRecoveryEmail(e.target.value); setError(null); }}
                  required
                  disabled={isLoading}
                />

                <button
                  type="submit"
                  className="mgp-btn mgp-btn-primary mgp-btn-full"
                  style={{ marginTop: 8 }}
                  disabled={isLoading}
                >
                  {isLoading ? 'Enviando...' : 'Enviar instrucciones'}
                </button>

                <button
                  type="button"
                  onClick={() => { setMode('login'); setError(null); }}
                  style={{
                    display: 'block', width: '100%', background: 'none', border: 'none',
                    color: '#64748B', fontSize: 13, marginTop: 16,
                    cursor: 'pointer', textDecoration: 'underline',
                    padding: 0, fontFamily: 'inherit', textAlign: 'center'
                  }}
                >
                  Volver al inicio de sesión
                </button>
              </>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

