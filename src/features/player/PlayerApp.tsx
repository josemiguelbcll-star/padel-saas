import './player.css';
import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePlayerSession } from './hooks/usePlayerSession';
import { useMyReservas } from './hooks/useMyReservas';
import { PlayerLoginPage } from './auth/PlayerLoginPage';
import { PlayerOnboarding } from './auth/PlayerOnboarding';
import { HomeTab } from './tabs/HomeTab';
import { ExplorarTab } from './tabs/ExplorarTab';
import { JugarTab } from './tabs/JugarTab';
import { PartidosTab } from './tabs/PartidosTab';
import { PerfilTab } from './tabs/PerfilTab';
import { ClubProfilePage } from '@/features/landing';

type PlayerTab = 'home' | 'reservar' | 'jugar' | 'partidos' | 'perfil';

// Badge Jugar: 0 hasta que el módulo de partidos tenga backend real
const JUGAR_BADGE = 0;

const NAV_ITEMS: { id: PlayerTab; label: string; icon: JSX.Element }[] = [
  {
    id: 'home',
    label: 'Inicio',
    icon: (
      <svg width={22} height={22} viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    id: 'reservar',
    label: 'Reservar',
    icon: (
      /* Icono: lupa + cancha (search) */
      <svg width={22} height={22} viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
  {
    id: 'jugar',
    label: 'Jugar',
    icon: (
      /* Icono: dos personas (comunidad) */
      <svg width={22} height={22} viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    id: 'partidos',
    label: 'Partidos',
    icon: (
      /* Icono: calendario */
      <svg width={22} height={22} viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    id: 'perfil',
    label: 'Perfil',
    icon: (
      <svg width={22} height={22} viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
];

const TAB_TITLE: Record<PlayerTab, string> = {
  home:     'Tu comunidad de pádel',
  reservar: 'Explorar canchas',
  jugar:    'Buscar partido',
  partidos: 'Mis partidos',
  perfil:   'Mi perfil',
};

export function PlayerApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const { phase, login, completeOnboarding, logout } = usePlayerSession();
  const { proximas, historial, isLoading: isLoadingReservas, reload } = useMyReservas();
  const [tab, setTab] = useState<PlayerTab>('home');
  const [clubSlug, setClubSlug] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);

  useEffect(() => {
    const pathParts = location.pathname.replace(/\/+$/, '').split('/').slice(2);
    const first = pathParts[0] ?? '';
    if (first === 'reservar') {
      setTab('reservar');
      return;
    }
    if (first === 'jugar') {
      setTab('jugar');
      return;
    }
    if (first === 'partidos') {
      setTab('partidos');
      return;
    }
    if (first === 'perfil') {
      setTab('perfil');
      return;
    }
    if (first === '' || first === '/') {
      setTab('home');
    }
  }, [location.pathname]);

  useEffect(() => {
    if (!notification) return;
    const timeout = window.setTimeout(() => setNotification(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [notification]);

  // ── Splash ────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div style={{
        width: '100%', height: '100dvh',
        background: '#0B1F4D',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 8,
      }}>
        <span style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 32, color: '#fff', lineHeight: 1 }}>
          MatchGo
        </span>
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>Cargando...</span>
      </div>
    );
  }

  if (phase === 'auth')        return <PlayerLoginPage onLogin={login} />;
  if (phase === 'onboarding')  return <PlayerOnboarding onComplete={completeOnboarding} />;

  return (
    <div className="mg-player">

      {/* ── Topbar ─────────────────────────────────────────────── */}
      <div className="mgp-topbar">
        {clubSlug ? (
          <button
            onClick={() => setClubSlug(null)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#ffffff',
              fontFamily: 'Inter, sans-serif',
              fontSize: 15,
              fontWeight: 600,
              padding: '4px 0',
            }}
          >
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Volver
          </button>
        ) : (
          <>
            <strong style={{ fontFamily: 'Poppins, sans-serif', fontSize: 18 }}>MatchGo</strong>
            <div className="mgp-topbar-sub">{TAB_TITLE[tab]}</div>
          </>
        )}
      </div>

      {notification && (
        <div style={{
          background: '#DBEAFE',
          border: '1px solid #BFDBFE',
          color: '#1D4ED8',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          margin: '12px 16px 0',
          borderRadius: 16,
          fontSize: 14,
        }}>
          <span>{notification}</span>
          <button
            onClick={() => setNotification(null)}
            style={{
              border: 'none',
              background: 'transparent',
              color: '#2563EB',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >Cerrar</button>
        </div>
      )}

      {/* ── Contenido ──────────────────────────────────────────── */}
      <div className="mgp-content">
        {clubSlug ? (
          <ClubProfilePage
            slugProp={clubSlug}
            onBack={() => setClubSlug(null)}
            onReservaCreada={() => {
              setClubSlug(null);
              setTab('partidos');
              setNotification('¡Pre-reserva realizada! Recordá enviar la seña para confirmar tu turno.');
              // Recargar reservas para mostrar la nueva
              reload();
            }}
          />
        ) : (
          <>
            {tab === 'home'     && (
              <HomeTab
                onGoReservar={() => { navigate('/player/reservar'); setTab('reservar'); }}
                onGoJugar={() => { navigate('/player/jugar'); setTab('jugar'); }}
                onGoPartidos={() => { navigate('/player/partidos'); setTab('partidos'); }}
                proximaReserva={proximas[0] ?? null}
              />
            )}
            {tab === 'reservar' && <ExplorarTab onSelectClub={setClubSlug} />}
            {tab === 'jugar'    && <JugarTab />}
            {tab === 'partidos' && (
              <PartidosTab
                proximas={proximas}
                historial={historial}
                isLoading={isLoadingReservas}
              />
            )}
            {tab === 'perfil'   && (
              <PerfilTab
                onLogout={() => { navigate('/player/perfil'); setTab('perfil'); logout(); }}
                proximas={proximas}
                historial={historial}
                isLoadingReservas={isLoadingReservas}
              />
            )}
          </>
        )}
      </div>

      {/* ── Bottom nav ─────────────────────────────────────────── */}
      <nav className="mgp-bottomnav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`mgp-tab${tab === item.id ? ' active' : ''}`}
            onClick={() => {
              setTab(item.id);
              navigate(item.id === 'home' ? '/player' : `/player/${item.id}`);
            }}
          >
            {/* Badge en Jugar: partidos disponibles */}
            {item.id === 'jugar' && JUGAR_BADGE > 0 && (
              <span className="mgp-tab-badge">{JUGAR_BADGE}</span>
            )}
            <span className="mgp-tab-icon">{item.icon}</span>
            <span className="mgp-tab-label">{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
