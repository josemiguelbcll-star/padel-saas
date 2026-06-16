import './landing.css';
import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

export function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const faqRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        }),
      { threshold: 0.12 }
    );
    document.querySelectorAll('.mg-landing .reveal').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const faqs = [
    {
      q: '¿Puedo reservar desde el celular?',
      a: 'Sí, MatchGo está optimizado para móviles. Podés reservar, pagar y recibir confirmación en segundos desde tu smartphone, sin necesidad de instalar ninguna app.',
    },
    {
      q: '¿Cómo sé si la cancha está disponible?',
      a: 'La disponibilidad se actualiza en tiempo real. Lo que ves en el buscador refleja el estado exacto en ese momento — sin overbooking ni sorpresas.',
    },
    {
      q: '¿Qué pasa si tengo que cancelar?',
      a: 'Cada club define su política de cancelación. Vas a ver claramente las condiciones antes de confirmar tu reserva. En muchos casos podés cancelar sin cargo con suficiente anticipación.',
    },
    {
      q: '¿Puedo pagar online o solo en el club?',
      a: 'Depende del club. Algunos habilitan el pago online completo (seña o total); otros prefieren cobrar en el mostrador. La plataforma soporta ambos flujos.',
    },
    {
      q: '¿Soy dueño de un club, cómo me sumo?',
      a: 'Completá el formulario de contacto y te mostramos la plataforma en vivo. La configuración toma menos de un día y no necesitás saber de tecnología.',
    },
    {
      q: '¿Qué deportes están disponibles?',
      a: 'Hoy cubrimos pádel y tenis. Estamos sumando fútbol, básquet y otros deportes de cancha — si tenés un complejo multideporte, escribinos.',
    },
  ];

  return (
    <div className="mg-landing">
      {/* ===== NAV ===== */}
      <header className="nav">
        <div className="wrap">
          <div className="nav-inner">
            <a href="#top" className="logo">
              <img src="/assets/matchgo_logo.svg" alt="MatchGo" className="logo-img" />
            </a>
            <nav className="nav-links">
              <Link to="/player">Reservá</Link>
              <a href="#deportes">Deportes</a>
              <a href="#comojugador">Cómo funciona</a>
              <a href="#software">Software para clubes</a>
            </nav>
            <div className="nav-cta">
              <Link to="/login" className="btn btn-ghost" style={{ fontSize: '0.85rem' }}>Iniciar sesión</Link>
              <Link to="/player" className="btn btn-primary">Reservá tu cancha</Link>
            </div>
            <button
              className="nav-toggle"
              aria-label="Menú"
              onClick={() => setMenuOpen((prev) => !prev)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {menuOpen ? (
                  <>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </>
                ) : (
                  <>
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                  </>
                )}
              </svg>
            </button>
          </div>
        </div>
        <div className="mobile-menu" style={{ display: menuOpen ? 'flex' : 'none' }}>
          <Link to="/player" onClick={() => setMenuOpen(false)}>Reservá</Link>
          <a href="#deportes" onClick={() => setMenuOpen(false)}>Deportes</a>
          <a href="#comojugador" onClick={() => setMenuOpen(false)}>Cómo funciona</a>
          <a href="#software" onClick={() => setMenuOpen(false)}>Software para clubes</a>
          <Link to="/player" className="btn btn-primary" onClick={() => setMenuOpen(false)}>Reservá tu cancha</Link>
          <Link to="/login" className="btn btn-ghost" onClick={() => setMenuOpen(false)}>Iniciar sesión</Link>
        </div>
      </header>

      {/* ===== HERO B2C ===== */}
      <section className="hero-b2c" id="reservar" style={{ paddingBottom: '120px' }}>
        <div className="hb-bg">
          <img src="/assets/act-padel-a.jpg" alt="Jugadores de pádel" />
        </div>
        <div className="hb-overlay" />
        <div className="hb-inner">
          <div className="wrap">
            <span className="rc-eyebrow">Pádel y tenis · disponibilidad en vivo</span>
            <h1>Tu próximo partido, <span className="hl">a un click</span></h1>
            <p className="hb-lead" style={{ marginBottom: '32px' }}>
              Encontrá tu club, mirá la disponibilidad real y reservá tu cancha en segundos. Sin llamados, sin esperar respuesta por WhatsApp.
            </p>

          </div>
        </div>
      </section>

      {/* ===== CÓMO FUNCIONA PARA EL JUGADOR ===== */}
      <section id="comojugador">
        <div className="wrap">
          <div className="center">
            <span className="eyebrow">Para jugadores</span>
            <h2 className="section-title">Reservá en 3 pasos</h2>
            <p className="section-lead">
              Sin llamadas, sin WhatsApp, sin esperar confirmación manual.
            </p>
          </div>
          <div className="steps reveal" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
            <div className="step">
              <div className="sn">1</div>
              <h3>Buscá</h3>
              <p>Elegí deporte, zona, fecha y horario. Ves solo canchas disponibles.</p>
            </div>
            <div className="step">
              <div className="sn">2</div>
              <h3>Reservá</h3>
              <p>Seleccioná la cancha y confirmá. Podés pagar online o en el club.</p>
            </div>
            <div className="step">
              <div className="sn">3</div>
              <h3>Jugá</h3>
              <p>Recibís confirmación al instante. Presentate y a la cancha.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== DEPORTES ===== */}
      <section id="deportes" style={{ background: 'var(--bg-soft)' }}>
        <div className="wrap">
          <div className="center" style={{ marginBottom: '48px' }}>
            <span className="eyebrow">Deportes disponibles</span>
            <h2 className="section-title">Pádel y Tenis</h2>
            <p className="section-lead">
              Dos deportes, una sola plataforma. Más deportes próximamente.
            </p>
          </div>
          <div className="dep-cards reveal">
            <div className="dep-card">
              <img src="/assets/act-padel-a.jpg" alt="Pádel" />
              <div className="dep-ov" />
              <div className="dep-meta">
                <h3>Pádel</h3>
                <p>Canchas cubiertas y al aire libre en los mejores clubes</p>
              </div>
            </div>
            <div className="dep-card">
              <img src="/assets/act-tennis-b.jpg" alt="Tenis" />
              <div className="dep-ov" />
              <div className="dep-meta">
                <h3>Tenis</h3>
                <p>Superficies rápidas, polvo de ladrillo y césped sintético</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== SOFTWARE PARA CLUBES ===== */}
      <section id="software">
        <div className="wrap">
          <div className="sw-grid">
            <div className="dive-text">
              <span className="eyebrow">¿Tenés un club?</span>
              <h2 className="section-title">El software que gestiona tu club entero — y lo contabiliza solo</h2>
              <p className="section-lead">
                Detrás de cada reserva hay un sistema completo de gestión. Grilla, mostrador, caja y finanzas: lo que operás arriba se contabiliza abajo, sin Excel paralelo.
              </p>
              <div className="sw-cta">
                <a href="#plataforma" className="btn btn-primary btn-lg">Ver funcionalidades</a>
              </div>
            </div>
            <div className="sw-photo reveal">
              <img src="/assets/padel-2.jpg" alt="Software de gestión MatchGo" />
              <div className="sw-badge">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Todo contabilizado, en vivo
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== CAPABILITY STRIP ===== */}
      <div className="strip">
        <div className="wrap">
          <div className="strip-grid">
            <div className="strip-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              Grilla de reservas
            </div>
            <div className="strip-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
              Cobros y caja
            </div>
            <div className="strip-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h7v7H3z"/><path d="M14 3h7v7h-7z"/><path d="M14 14h7v7h-7z"/><path d="M3 14h7v7H3z"/></svg>
              Turnos fijos
            </div>
            <div className="strip-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
              Buffet y stock
            </div>
            <div className="strip-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
              EERR y finanzas
            </div>
          </div>
        </div>
      </div>

      {/* ===== PROBLEMA ===== */}
      <section style={{ background: 'var(--bg-soft)' }}>
        <div className="wrap">
          <div className="center">
            <span className="eyebrow">El problema</span>
            <h2 className="section-title">Gestionar un club es más difícil de lo que debería</h2>
            <p className="section-lead">
              La mayoría de los clubes siguen usando WhatsApp, planillas y cajas manuales.
              El resultado: errores, tiempo perdido y dinero que se escapa.
            </p>
          </div>
          <div className="prob-grid reveal">
            <div className="prob">
              <div className="prob-ico">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              </div>
              <h3>Doble reserva</h3>
              <p>Sin sistema central, dos personas reservan la misma cancha al mismo tiempo.</p>
            </div>
            <div className="prob">
              <div className="prob-ico">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              </div>
              <h3>Caja sin control</h3>
              <p>No sabés cuánto entrió hoy, qué medios de pago se usaron ni si cuadra.</p>
            </div>
            <div className="prob">
              <div className="prob-ico">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </div>
              <h3>Tiempo en WhatsApp</h3>
              <p>El personal pasa horas coordinando reservas por mensajes en vez de atender el club.</p>
            </div>
            <div className="prob">
              <div className="prob-ico">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
              </div>
              <h3>Sin visibilidad financiera</h3>
              <p>No tenés un Estado de Resultados real. No sabés qué unidad gana y cuál pierde.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== CÓMO FUNCIONA (PARA CLUBES) ===== */}
      <section id="como">
        <div className="wrap">
          <div className="center">
            <span className="eyebrow">Cómo funciona</span>
            <h2 className="section-title">De cero a funcionando en un día</h2>
          </div>
          <div className="steps reveal">
            <div className="step">
              <div className="sn">1</div>
              <h3>Alta del club</h3>
              <p>Cargamos tus canchas, horarios y tarifas. Sin configuración técnica de tu parte.</p>
            </div>
            <div className="step">
              <div className="sn">2</div>
              <h3>Primera reserva</h3>
              <p>Tu equipo reserva desde la grilla. El cobro queda registrado automáticamente.</p>
            </div>
            <div className="step">
              <div className="sn">3</div>
              <h3>Cierre de caja</h3>
              <p>Al final del día, cerrás la caja con un click. El sistema cuadra solo.</p>
            </div>
            <div className="step">
              <div className="sn">4</div>
              <h3>Resultados</h3>
              <p>Ves el Estado de Resultados por unidad de negocio: canchas, buffet, clases.</p>
            </div>
            <div className="step">
              <div className="sn">5</div>
              <h3>Crecés</h3>
              <p>Con datos reales tomás mejores decisiones. Subís tarifas, optimizás horarios.</p>
            </div>
          </div>
          <p className="steps-foot">
            <strong>Sin instalación, sin servidor propio.</strong> Todo en la nube, accesible desde cualquier dispositivo.
          </p>
        </div>
      </section>

      {/* ===== PLATAFORMA 3 COLS ===== */}
      <section id="plataforma" style={{ background: 'var(--bg-soft)' }}>
        <div className="wrap">
          <div className="center">
            <span className="eyebrow">La plataforma</span>
            <h2 className="section-title">Todo lo que necesita tu club</h2>
            <p className="section-lead">Operaciones, finanzas y control en un solo sistema.</p>
          </div>
          <div className="plat reveal">
            <div className="plat-col">
              <h3>Operaciones</h3>
              <div className="plat-li">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Grilla de reservas en tiempo real
              </div>
              <div className="plat-li">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Turnos fijos con tarifas programadas
              </div>
              <div className="plat-li">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Cobros multi-medio (efectivo, débito, MP)
              </div>
              <div className="plat-li">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Clases y profesores
              </div>
              <div className="plat-li">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                POS de buffet con stock
              </div>
            </div>
            <div className="plat-col fin">
              <h3>Finanzas</h3>
              <div className="plat-li">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Estado de Resultados por unidad
              </div>
              <div className="plat-li">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Flujo de caja real + proyectado
              </div>
              <div className="plat-li">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Gastos, proveedores y compras
              </div>
              <div className="plat-li">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Cuentas por pagar y cuotas
              </div>
              <div className="plat-li">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Tesorería multi-cuenta
              </div>
            </div>
            <div className="plat-col ctrl">
              <h3>Control</h3>
              <div className="plat-li">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Roles admin / vendedor
              </div>
              <div className="plat-li">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Cierre de caja diario
              </div>
              <div className="plat-li">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Auditoría de anulaciones
              </div>
              <div className="plat-li">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Multi-tenant con RLS estricta
              </div>
              <div className="plat-li">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Disponibilidad 99.5%+
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== DIVE: GRILLA ===== */}
      <section>
        <div className="wrap">
          <div className="dive">
            <div className="dive-text reveal">
              <span className="eyebrow">Grilla de reservas</span>
              <h2 className="section-title">Tu agenda en tiempo real</h2>
              <p className="section-lead">
                Vista diaria y semanal de todas las canchas. Reservas sueltas,
                turnos fijos y clases en un solo lugar.
              </p>
              <div className="dive-list">
                <div className="dive-li">
                  <div className="chk">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <div>
                    <h4>Duración configurable por franja</h4>
                    <p>60, 90 o 120 minutos según el horario. El precio se resuelve automáticamente.</p>
                  </div>
                </div>
                <div className="dive-li">
                  <div className="chk">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <div>
                    <h4>Tarifas con vigencia temporal</h4>
                    <p>Programá aumentos a futuro. El sistema aplica la tarifa correcta a cada fecha.</p>
                  </div>
                </div>
                <div className="dive-li">
                  <div className="chk">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <div>
                    <h4>Estados visuales claros</h4>
                    <p>Cada bloque muestra su estado: libre, reservado, en curso, cerrado o cancelado.</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="reveal">
              <div className="mockup">
                <div className="mockup-bar">
                  <i /><i /><i />
                  <span className="mb-title">Grilla del día — Sábado 7 jun</span>
                  <span className="mb-live">
                    <span className="live-dot" />
                    En vivo
                  </span>
                </div>
                <div style={{ padding: '16px', overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr>
                        <th style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--muted)', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid var(--border)' }}>Hora</th>
                        {['Cancha 1', 'Cancha 2', 'Cancha 3'].map((c) => (
                          <th key={c} style={{ padding: '6px 10px', textAlign: 'center', color: 'var(--muted)', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid var(--border)' }}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { h: '08:00', c1: { t: 'Reservado', bg: '#e9edf8', co: 'var(--primary)' }, c2: { t: 'Libre', bg: 'var(--bg-soft)', co: 'var(--muted)' }, c3: { t: 'Turno fijo', bg: '#fff5e6', co: '#b45309' } },
                        { h: '09:30', c1: { t: 'Libre', bg: 'var(--bg-soft)', co: 'var(--muted)' }, c2: { t: 'Reservado', bg: '#e9edf8', co: 'var(--primary)' }, c3: { t: 'Reservado', bg: '#e9edf8', co: 'var(--primary)' } },
                        { h: '11:00', c1: { t: 'Cerrado', bg: '#f1f5f9', co: '#94a3b8' }, c2: { t: 'Libre', bg: 'var(--bg-soft)', co: 'var(--muted)' }, c3: { t: 'Clase', bg: '#eafaec', co: 'var(--emerald)' } },
                        { h: '12:30', c1: { t: 'Libre', bg: 'var(--bg-soft)', co: 'var(--muted)' }, c2: { t: 'Turno fijo', bg: '#fff5e6', co: '#b45309' }, c3: { t: 'Libre', bg: 'var(--bg-soft)', co: 'var(--muted)' } },
                      ].map((row) => (
                        <tr key={row.h}>
                          <td style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--ink)', fontSize: '12px', borderBottom: '1px solid var(--bg-soft)' }}>{row.h}</td>
                          {[row.c1, row.c2, row.c3].map((cell, i) => (
                            <td key={i} style={{ padding: '6px', textAlign: 'center', borderBottom: '1px solid var(--bg-soft)' }}>
                              <span style={{ display: 'inline-block', padding: '5px 12px', borderRadius: '999px', background: cell.bg, color: cell.co, fontWeight: 600, fontSize: '11.5px' }}>{cell.t}</span>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== DIVE: RESERVAS ONLINE ===== */}
      <section id="reservas" style={{ background: 'var(--bg-soft)' }}>
        <div className="wrap">
          <div className="dive rev">
            <div className="dive-text reveal">
              <span className="eyebrow">Reservas online</span>
              <h2 className="section-title">Tus clientes reservan solos</h2>
              <p className="section-lead">
                Portal de reservas propio del club. El jugador elige fecha,
                cancha y horario. Vos solo ves la grilla llenarse.
              </p>
              <div className="dive-list">
                <div className="dive-li">
                  <div className="chk">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <div>
                    <h4>Confirmación instantánea</h4>
                    <p>Sin intervención del personal. La cancha queda bloqueada al instante.</p>
                  </div>
                </div>
                <div className="dive-li">
                  <div className="chk">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <div>
                    <h4>Seña online opcional</h4>
                    <p>Pedí un anticipo para garantizar la reserva y reducir ausencias.</p>
                  </div>
                </div>
                <div className="dive-li">
                  <div className="chk">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <div>
                    <h4>Flujo integrado con caja</h4>
                    <p>Cada reserva online llega a la grilla y al sistema de cobros del club.</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="reveal">
              <div className="panel">
                <div className="book-top">
                  <div className="bt-logo">M</div>
                  <div>
                    <div className="bt-name">Club MatchGo</div>
                    <div className="bt-sub">Palermo, Buenos Aires</div>
                  </div>
                  <div className="bt-tag">Disponible</div>
                </div>
                <div className="book-dates">
                  {['L 2', 'M 3', 'X 4', 'J 5', 'V 6', 'S 7', 'D 8'].map((d, i) => (
                    <div key={d} className={`book-date${i === 5 ? ' on' : ''}`}>
                      <div className="d">{d.split(' ')[1]}</div>
                      {d.split(' ')[0]}
                    </div>
                  ))}
                </div>
                <div className="book-label">Canchas disponibles — Sáb 7 jun</div>
                <div className="book-slots">
                  {['08:00', '09:30', '11:00', '12:30', '14:00', '15:30'].map((s, i) => (
                    <div key={s} className={`book-slot${[1, 3].includes(i) ? ' off' : i === 4 ? ' on' : ''}`}>{s}</div>
                  ))}
                </div>
                <div className="book-pay">
                  <span>Alquiler 90 min</span>
                  <b>$8.500</b>
                </div>
                <button className="book-btn">Confirmar reserva</button>
                <div className="book-flow">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  Confirmación instantánea · Sin cargo adicional
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== DIVE: CUENTA DEL TURNO ===== */}
      <section>
        <div className="wrap">
          <div className="dive">
            <div className="dive-text reveal">
              <span className="eyebrow">Cuenta del turno</span>
              <h2 className="section-title">El turno como una mesa de restaurante</h2>
              <p className="section-lead">
                Cada reserva abre una cuenta. Los jugadores cargan consumos del buffet
                o shop y al final pagan todo junto, dividido como quieran.
              </p>
              <div className="dive-list">
                <div className="dive-li">
                  <div className="chk">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <div>
                    <h4>Consumos acumulados</h4>
                    <p>Pelotas, bebidas, snacks — todo queda en la cuenta del turno.</p>
                  </div>
                </div>
                <div className="dive-li">
                  <div className="chk">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <div>
                    <h4>División informativa</h4>
                    <p>El sistema calcula cuánto le toca a cada jugador. Sin discusiones.</p>
                  </div>
                </div>
                <div className="dive-li">
                  <div className="chk">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <div>
                    <h4>Cobro parcial por persona</h4>
                    <p>Cada jugador paga su parte en el medio que quiera. Mixto soportado.</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="reveal">
              <div className="panel">
                <div className="panel-head">
                  <span className="pt">Cuenta del turno · Can. 2 · 10:00</span>
                  <span className="pill">Abierta</span>
                </div>
                <div className="acct-row line">
                  <span className="lbl">
                    <span className="acct-ico" style={{ background: 'var(--primary-soft)' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/></svg>
                    </span>
                    Alquiler 90 min
                  </span>
                  <span className="amt">$8.500</span>
                </div>
                <div className="acct-row line">
                  <span className="lbl">
                    <span className="acct-ico" style={{ background: 'var(--emerald-soft)' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--emerald)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/></svg>
                    </span>
                    Pelotas Dunlop × 2
                  </span>
                  <span className="amt">$3.200</span>
                </div>
                <div className="acct-row">
                  <span className="lbl">
                    <span className="acct-ico" style={{ background: '#fff5e6' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/></svg>
                    </span>
                    Gatorade × 4
                  </span>
                  <span className="amt">$2.800</span>
                </div>
                <div className="acct-total">
                  <span className="lbl">Total</span>
                  <span className="amt">$14.500</span>
                </div>
                <div className="split">
                  {[
                    { av: 'JM', nm: 'Juan M.', vl: '$3.625', paid: true },
                    { av: 'LC', nm: 'Luis C.', vl: '$3.625', paid: false },
                    { av: 'PA', nm: 'Pedro A.', vl: '$3.625', paid: false },
                    { av: 'MG', nm: 'Martín G.', vl: '$3.625', paid: false },
                  ].map((p) => (
                    <div key={p.av} className={`split-card${p.paid ? ' paid' : ''}`}>
                      <div className="av">{p.av}</div>
                      <div className="nm">{p.nm}</div>
                      <div className="vl">{p.vl}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== MOTOR CONTABLE ===== */}
      <section style={{ background: 'var(--bg-soft)' }}>
        <div className="wrap">
          <div className="center reveal">
            <span className="eyebrow">Motor contable</span>
            <h2 className="section-title">Devengado y percibido, sin mezclarlos</h2>
            <p className="section-lead">
              El sistema entiende la diferencia entre cuándo se generó el ingreso y
              cuándo entró la plata. Así funciona la contabilidad real.
            </p>
          </div>
          <div className="motor reveal">
            <div className="motor-grid">
              <div className="motor-col">
                <h4>Entradas (percibido)</h4>
                <div className="motor-item">
                  <div className="mi-t">Cobro de turno</div>
                  <div className="mi-d">Efectivo, débito, MP — en el momento</div>
                </div>
                <div className="motor-item">
                  <div className="mi-t">Venta POS buffet</div>
                  <div className="mi-d">Registro inmediato con stock</div>
                </div>
                <div className="motor-item">
                  <div className="mi-t">Cobro de clase</div>
                  <div className="mi-d">Vinculado al profesor y la cancha</div>
                </div>
              </div>
              <div className="motor-core">
                <div className="mc-badge">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                </div>
                <div className="mc-t">Motor EERR</div>
                <div className="mc-d">Atribución por unidad de negocio</div>
              </div>
              <div className="motor-col motor-out">
                <h4>Salidas (devengado)</h4>
                <div className="motor-item">
                  <div className="mi-t">Gasto del período</div>
                  <div className="mi-d">Se registra cuando se devenga</div>
                </div>
                <div className="motor-item">
                  <div className="mi-t">CMV (costo de lo vendido)</div>
                  <div className="mi-d">Solo al vender, no al comprar</div>
                </div>
                <div className="motor-item">
                  <div className="mi-t">Cuotas a proveedores</div>
                  <div className="mi-d">Total con IVA — deuda real</div>
                </div>
              </div>
            </div>
            <div className="motor-foot">
              El EERR es devengado · El flujo de caja es percibido · Nunca se mezclan
            </div>
          </div>
        </div>
      </section>

      {/* ===== DIVE: EERR ===== */}
      <section id="finanzas">
        <div className="wrap">
          <div className="dive rev">
            <div className="dive-text reveal">
              <span className="eyebrow">Estado de Resultados</span>
              <h2 className="section-title">Rentabilidad real por unidad de negocio</h2>
              <p className="section-lead">
                No solo "cuánto entrió": Canchas, Buffet, Shop y Clases cada uno
                con su ingreso, su costo y su margen real.
              </p>
              <div className="dive-list">
                <div className="dive-li">
                  <div className="chk">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <div>
                    <h4>Capas del EERR</h4>
                    <p>Margen bruto → resultado operativo → resultado neto. Estructura y financieros separados.</p>
                  </div>
                </div>
                <div className="dive-li">
                  <div className="chk">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <div>
                    <h4>CMV real</h4>
                    <p>El costo entra cuando se vende, no cuando se compra. Margen sin distorsión.</p>
                  </div>
                </div>
                <div className="dive-li">
                  <div className="chk">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <div>
                    <h4>IVA excluido del resultado</h4>
                    <p>Los márgenes se calculan sobre neto. El IVA es flujo, no ganancia.</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="reveal">
              <div className="panel">
                <div className="panel-head">
                  <span className="pt">Estado de Resultados · Junio 2025</span>
                  <span className="pill">+12% vs may</span>
                </div>
                {[
                  { un: 'Canchas', w: '82%', bg: 'var(--primary)', v: '$680.000' },
                  { un: 'Buffet', w: '45%', bg: 'var(--emerald)', v: '$124.000' },
                  { un: 'Shop', w: '30%', bg: 'var(--violet)', v: '$82.000' },
                  { un: 'Clases', w: '25%', bg: 'var(--amber)', v: '$68.000' },
                ].map((r) => (
                  <div key={r.un} className="eerr-bar-row">
                    <span className="un">{r.un}</span>
                    <div className="eerr-track">
                      <div className="eerr-fill" style={{ width: r.w, background: r.bg }}>{r.v}</div>
                    </div>
                  </div>
                ))}
                <div className="eerr-foot">
                  <span className="l">Resultado neto del período</span>
                  <span className="r">+$214.300</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== DIVE: FLUJO DE CAJA ===== */}
      <section style={{ background: 'var(--bg-soft)' }}>
        <div className="wrap">
          <div className="dive">
            <div className="dive-text reveal">
              <span className="eyebrow">Flujo de caja</span>
              <h2 className="section-title">Sabé cuándo entra y sale la plata</h2>
              <p className="section-lead">
                Vista real + proyectada del flujo. El saldo proyectado arranca
                desde el saldo real de hoy, no desde cero.
              </p>
              <div className="dive-list">
                <div className="dive-li">
                  <div className="chk">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <div>
                    <h4>Real + proyectado encadenado</h4>
                    <p>La proyección toma el saldo real de hoy y suma compromisos futuros.</p>
                  </div>
                </div>
                <div className="dive-li">
                  <div className="chk">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <div>
                    <h4>Alerta de valle de liquidez</h4>
                    <p>El sistema detecta el período más crítico y te avisa antes de que llegue.</p>
                  </div>
                </div>
                <div className="dive-li">
                  <div className="chk">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <div>
                    <h4>Granularidad diaria, semanal o mensual</h4>
                    <p>Ajustá el zoom según lo que necesitás ver. Los números siempre cuadran.</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="reveal">
              <div className="mockup">
                <div className="mockup-bar">
                  <i /><i /><i />
                  <span className="mb-title">Flujo de caja — Jun–Sep 2025</span>
                </div>
                <div className="cf">
                  <div className="cf-head">
                    <div className="cf-kpi">
                      <div className="k-l">Saldo actual</div>
                      <div className="k-v">$482.100</div>
                    </div>
                    <div className="cf-kpi ok">
                      <div className="k-l">Proyectado 90d</div>
                      <div className="k-v">+$318.400</div>
                    </div>
                    <div className="cf-kpi">
                      <div className="k-l">Valle mínimo</div>
                      <div className="k-v" style={{ color: 'var(--rose)' }}>$94.200</div>
                    </div>
                  </div>
                  <svg className="cf-svg" viewBox="0 0 460 120" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="gr" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#0B1F4D" stopOpacity=".18" />
                        <stop offset="100%" stopColor="#0B1F4D" stopOpacity=".02" />
                      </linearGradient>
                      <linearGradient id="gp" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#39C54A" stopOpacity=".15" />
                        <stop offset="100%" stopColor="#39C54A" stopOpacity=".02" />
                      </linearGradient>
                    </defs>
                    {/* área real */}
                    <path d="M0,90 C40,85 80,70 130,65 L130,120 L0,120Z" fill="url(#gr)" />
                    <path d="M0,90 C40,85 80,70 130,65" fill="none" stroke="var(--marino)" strokeWidth="2.5" strokeLinecap="round" />
                    {/* área proyectada */}
                    <path d="M130,65 C180,58 220,80 270,50 C310,26 360,40 460,30 L460,120 L130,120Z" fill="url(#gp)" />
                    <path d="M130,65 C180,58 220,80 270,50 C310,26 360,40 460,30" fill="none" stroke="var(--green)" strokeWidth="2.5" strokeDasharray="6,4" strokeLinecap="round" />
                    {/* marcador hoy */}
                    <line x1="130" y1="10" x2="130" y2="110" stroke="var(--muted)" strokeWidth="1" strokeDasharray="3,3" />
                    <text x="134" y="22" fontSize="9" fill="var(--muted)" fontWeight="600">Hoy</text>
                    {/* valle */}
                    <circle cx="270" cy="50" r="4" fill="var(--rose)" />
                  </svg>
                  <div className="cf-legend">
                    <span><span className="lg-real" />Real</span>
                    <span><span className="lg-proj" />Proyectado</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== ROLES ===== */}
      <section id="roles">
        <div className="wrap">
          <div className="center">
            <span className="eyebrow">Control de acceso</span>
            <h2 className="section-title">Cada rol ve lo que necesita</h2>
            <p className="section-lead">
              Dos perfiles bien definidos. El admin tiene visibilidad total;
              el vendedor opera sin acceder a información sensible.
            </p>
          </div>
          <div className="roles reveal">
            <div className="role admin">
              <div className="role-head">
                <div className="role-ico">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                </div>
                <div>
                  <h3>Administrador</h3>
                  <div className="role-sub">Dueño / gerente del club</div>
                </div>
              </div>
              {['Grilla de reservas completa', 'Cierre y apertura de caja', 'Estado de Resultados y finanzas', 'Configuración de tarifas', 'Anulaciones y correcciones', 'Gestión de usuarios'].map((item) => (
                <div key={item} className="role-li">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  {item}
                </div>
              ))}
            </div>
            <div className="role vend">
              <div className="role-head">
                <div className="role-ico">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </div>
                <div>
                  <h3>Vendedor</h3>
                  <div className="role-sub">Recepcionista / personal de mostrador</div>
                </div>
              </div>
              {[
                { t: 'Grilla de reservas (operar)', ok: true },
                { t: 'Cobros y POS de buffet', ok: true },
                { t: 'Cargar consumos del turno', ok: true },
                { t: 'Ver estado de caja', ok: true },
                { t: 'EERR y finanzas', ok: false },
                { t: 'Configuración y usuarios', ok: false },
              ].map((item) => (
                <div key={item.t} className={`role-li${item.ok ? '' : ' no'}`}>
                  {item.ok ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  )}
                  {item.t}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>



      {/* ===== FAQ ===== */}
      <section>
        <div className="wrap">
          <div className="center">
            <span className="eyebrow">FAQ</span>
            <h2 className="section-title">Preguntas frecuentes</h2>
          </div>
          <div className="faq-list">
            {faqs.map((faq, i) => (
              <div key={i} className={`faq-item${openFaq === i ? ' open' : ''}`}>
                <button
                  className="faq-q"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  {faq.q}
                  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                </button>
                <div
                  className="faq-a"
                  ref={(el) => { faqRefs.current[i] = el; }}
                  style={{ maxHeight: openFaq === i ? `${faqRefs.current[i]?.scrollHeight ?? 200}px` : '0' }}
                >
                  <p>{faq.a}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>



      {/* ===== FOOTER ===== */}
      <footer>
        <div className="wrap">
          <div className="foot-grid">
            <div className="foot-brand">
              <a href="#top" className="logo">
                <img src="/assets/matchgo_logo.svg" alt="MatchGo" className="logo-img" />
              </a>
              <p>
                La plataforma de gestión para clubes de pádel y tenis que quieren
                crecer con datos reales.
              </p>
            </div>
            <div className="foot-col">
              <h4>Jugadores</h4>
              <Link to="/player">Reservar cancha</Link>
              <a href="#deportes">Deportes</a>
              <a href="#comojugador">Cómo funciona</a>
            </div>
            <div className="foot-col">
              <h4>Clubes</h4>
              <a href="#software">Software</a>
              <a href="#plataforma">Plataforma</a>

            </div>
            <div className="foot-col">
              <h4>Contacto</h4>
              <a href="mailto:hola@matchgo.ar">hola@matchgo.ar</a>
              <p>Buenos Aires, Argentina</p>
            </div>
          </div>
          <div className="foot-bottom">
            <span>© 2025 MatchGo. Todos los derechos reservados.</span>
            <span>Hecho con ❤ para el deporte argentino</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
