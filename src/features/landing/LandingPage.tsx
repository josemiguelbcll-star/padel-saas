import './landing.css';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Menu,
  ShieldCheck,
  Trophy,
  Users,
  UtensilsCrossed,
  X,
  Zap,
} from 'lucide-react';

import { PadelScrollReveal } from './PadelScrollReveal';

export function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedSport, setSelectedSport] = useState<'padel' | 'tenis'>('padel');
  const [activeSlot, setActiveSlot] = useState<string>('20:00');
  const [activeFeatureTab, setActiveFeatureTab] = useState<number>(0);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  // Split demo state
  const [beverageCount, setBeverageCount] = useState(4);
  const [ballCount, setBallCount] = useState(2);

  const courtPrice = 36000;
  const beveragePrice = 2500;
  const ballPrice = 4500;

  const totalMatchBill = courtPrice + beverageCount * beveragePrice + ballCount * ballPrice;
  const perPlayerBill = Math.round(totalMatchBill / 4);

  const featureTabs = [
    {
      id: 0,
      badge: 'GRILLA EN VIVO',
      title: 'Agenda inteligente y disponibilidad en tiempo real',
      desc: 'Visualizá tus canchas de un vistazo. Reservas automáticas, turnos fijos programados y tarifas dinámicas por horario sin solapamientos.',
      bullets: [
        {
          title: 'Cero doble reserva',
          desc: 'Bloqueo instantáneo de franjas tanto en el portal público como en recepción.',
        },
        {
          title: 'Tarifas y duraciones flexibles',
          desc: 'Franjas de 60, 90 o 120 min con aumentos programados a futuro.',
        },
        {
          title: 'Turnos fijos automatizados',
          desc: 'Asigná abonados semanales y cobrá sus cuotas mensuales con un click.',
        },
      ],
      previewType: 'grilla',
    },
    {
      id: 1,
      badge: 'DIVISIÓN DE PAGOS',
      title: 'Cuenta del turno con consumos y división por jugador',
      desc: 'Tratá cada turno como una mesa de restaurante. Cargá bebidas o pelotas y dividí la cuenta entre los 4 jugadores al instante.',
      bullets: [
        {
          title: 'Consumos acumulados al turno',
          desc: 'Sumá alquiler, bebidas y pelotas en una sola cuenta clara.',
        },
        {
          title: 'Reparto automático e informativo',
          desc: 'Calcula al instante cuánto le corresponde a cada integrante del partido.',
        },
        {
          title: 'Pagos mixtos por persona',
          desc: 'Uno paga en efectivo, otro con Mercado Pago o transferencia.',
        },
      ],
      previewType: 'cuenta',
    },
    {
      id: 2,
      badge: 'FINANZAS AUTOMÁTICAS',
      title: 'Estado de Resultados y rentabilidad por unidad',
      desc: 'Lo que cobrás arriba se contabiliza abajo. Separá los números de Canchas, Buffet, Clases y Torneos sin Excel paralelo.',
      bullets: [
        {
          title: 'Margen real devengado',
          desc: 'Diferencia real entre cuándo se genera el ingreso y cuándo entra el dinero.',
        },
        {
          title: 'Flujo de caja proyectado',
          desc: 'Proyección a 30, 60 y 90 días encadenada al saldo bancario real.',
        },
        {
          title: 'Cierre de caja en 1 click',
          desc: 'Control estricto de arqueo diario por turno con trazabilidad de anulaciones.',
        },
      ],
      previewType: 'finanzas',
    },
    {
      id: 3,
      badge: 'BUFFET & SHOP POS',
      title: 'Punto de venta integrado con control de stock',
      desc: 'Ventas directas en mostrador con descuento de inventario en vivo y alertas automáticas de reposición de mercadería.',
      bullets: [
        {
          title: 'Cobro exprés en mostrador',
          desc: 'Buscador veloz de productos con códigos de barra o categorías táctiles.',
        },
        {
          title: 'Alertas de stock bajo',
          desc: 'Te avisa antes de que te quedes sin pelotas, grips o bebidas frías.',
        },
        {
          title: 'Cálculo de CMV real',
          desc: 'El costo de mercadería entra al venderse, no al comprarse.',
        },
      ],
      previewType: 'buffet',
    },
  ];

  const faqs = [
    {
      q: '¿Los jugadores necesitan descargar una app para reservar?',
      a: 'No es obligatorio. Pueden reservar directamente desde el navegador de su teléfono o computadora en menos de 30 segundos, o guardar la aplicación en su pantalla de inicio como App Web.',
    },
    {
      q: '¿Cómo evita MatchGo las dobles reservas?',
      a: 'El motor de disponibilidad trabaja con bloqueos atómicos en tiempo real. Cuando un jugador o recepcionista selecciona una cancha, queda bloqueada al instante para el resto.',
    },
    {
      q: '¿Puedo configurar señas online y cobros en el club?',
      a: 'Sí, totalmente. Podés exigir el 100%, una seña parcial mediante Mercado Pago/Transferencia o habilitar el pago completo en recepción al presentarse.',
    },
    {
      q: '¿Cuánto tiempo lleva poner en marcha mi club?',
      a: 'Menos de 24 horas. Nuestro equipo te ayuda a cargar tus canchas, horarios, tarifas y abonados para que arranques a operar sin interrumpir tu día.',
    },
    {
      q: '¿El software maneja también profesores y clases?',
      a: 'Sí, incluye módulo de profesores, clases grupales o individuales, y cálculo automático de honorarios y cobros por alumno.',
    },
  ];

  return (
    <div className="mg-landing">
      {/* ===== NAV BAR ===== */}
      <header className="nav-bar">
        <div className="container">
          <div className="nav-content">
            <Link to="/" className="nav-logo">
              <img src="/assets/matchgo_logo.svg" alt="MatchGo" />
            </Link>

            <nav className="nav-menu">
              <Link to="/player" className="nav-link">
                Reservar Cancha
              </Link>
              <a href="#experiencia" className="nav-link">
                Para Jugadores & Clubes
              </a>
              <a href="#funcionalidades" className="nav-link">
                Funcionalidades
              </a>
              <a href="#faq" className="nav-link">
                Preguntas
              </a>
            </nav>

            <div className="nav-actions">
              <Link to="/login" className="btn-nav-login">
                Ingresar al Club
              </Link>
              <Link to="/player" className="btn-nav-primary">
                <Zap className="h-4 w-4" />
                Reservar Turno
              </Link>
            </div>

            <button
              type="button"
              className="mobile-toggle"
              aria-label="Abrir menú"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>

        {/* Mobile menu dropdown */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-white/10 bg-[#040914] p-6 space-y-4">
            <Link
              to="/player"
              className="block font-semibold text-white text-lg"
              onClick={() => setMobileMenuOpen(false)}
            >
              🎾 Reservar Cancha (Jugadores)
            </Link>
            <a
              href="#funcionalidades"
              className="block text-slate-400 font-medium"
              onClick={() => setMobileMenuOpen(false)}
            >
              ⚙️ Software para Clubes
            </a>
            <a
              href="#faq"
              className="block text-slate-400 font-medium"
              onClick={() => setMobileMenuOpen(false)}
            >
              ❓ Preguntas Frecuentes
            </a>
            <div className="pt-4 flex flex-col gap-3">
              <Link
                to="/player"
                className="btn-hero-primary justify-center text-center"
                onClick={() => setMobileMenuOpen(false)}
              >
                Reservar Cancha Online
              </Link>
              <Link
                to="/login"
                className="btn-hero-secondary justify-center text-center"
                onClick={() => setMobileMenuOpen(false)}
              >
                Acceso Administrador
              </Link>
            </div>
          </div>
        )}
      </header>

      {/* ===== HERO SECTION ===== */}
      <section className="hero-section">
        <div className="hero-court-lines" />
        <div className="container">
          <div className="hero-grid">
            {/* Columna Izquierda: Copy y CTA */}
            <div>
              {/* Badge interactivo superior */}
              <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-white/5 border border-white/10 hover:border-white/20 transition-all text-xs font-semibold text-slate-200 mb-6 group cursor-pointer">
                <span className="flex items-center gap-1.5 text-[#39C54A]">
                  <span className="w-2 h-2 rounded-full bg-[#39C54A] animate-pulse" />
                  MatchGo SaaS
                </span>
                <span className="w-px h-3 bg-white/20" />
                <span className="text-slate-300">Gestión Integral para Pádel & Tenis</span>
                <span className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-[#39C54A] group-hover:text-slate-950 transition-all">
                  <ArrowRight className="h-3 w-3" />
                </span>
              </div>

              <h1 className="hero-title">
                Tu partido arranca acá.{' '}
                <span className="gradient-text">La gestión de tu club también.</span>
              </h1>

              <p className="hero-lead">
                Encontrá canchas de pádel y tenis disponibles al instante. Para clubes,
                el software definitivo con grilla, cuenta del turno, caja y finanzas automáticas.
              </p>

              {/* Selector de Deporte Rápido */}
              <div className="flex items-center gap-2 mb-6">
                <button
                  type="button"
                  onClick={() => setSelectedSport('padel')}
                  className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-2 transition-all cursor-pointer ${
                    selectedSport === 'padel'
                      ? 'bg-[#39C54A] text-slate-950 shadow-[0_0_15px_rgba(57,197,74,0.4)]'
                      : 'bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10'
                  }`}
                >
                  <Trophy className="h-4 w-4" /> Pádel
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedSport('tenis')}
                  className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-2 transition-all cursor-pointer ${
                    selectedSport === 'tenis'
                      ? 'bg-[#39C54A] text-slate-950 shadow-[0_0_15px_rgba(57,197,74,0.4)]'
                      : 'bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10'
                  }`}
                >
                  <Activity className="h-4 w-4" /> Tenis
                </button>
              </div>

              <div className="hero-actions">
                <Link to="/player" className="btn-hero-primary">
                  <Zap className="h-5 w-5 fill-slate-950" />
                  Reservar en 30 segundos
                </Link>
                <a href="#funcionalidades" className="btn-hero-secondary">
                  Conocer el Software
                  <ArrowRight className="h-4 w-4" />
                </a>
              </div>

              <div className="flex items-center gap-6 text-xs text-slate-400 font-medium">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-[#39C54A]" /> Sin registros molestos
                </span>
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-[#39C54A]" /> Confirmación inmediata
                </span>
              </div>
            </div>

            {/* Columna Derecha: Tarjeta Interactiva en Vivo */}
            <div>
              <div className="hero-card-preview">
                <div className="hcp-header">
                  <div>
                    <span className="hcp-badge">
                      <span className="w-2 h-2 rounded-full bg-[#39C54A] animate-pulse" />
                      {selectedSport === 'padel' ? 'Pádel Panorámico' : 'Tenis Polvo'}
                    </span>
                    <h3 className="hcp-court-name mt-1">Cancha Central 1</h3>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-slate-400">Hoy · 90 min</span>
                    <p className="text-lg font-black text-[#39C54A]">$ 36.000</p>
                  </div>
                </div>

                {/* Grid interactivo de horarios */}
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Elegí tu horario en vivo:
                </p>
                <div className="hcp-time-grid">
                  {['18:30', '20:00', '21:30'].map((slot) => (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => setActiveSlot(slot)}
                      className={`time-slot-btn ${activeSlot === slot ? 'active' : ''}`}
                    >
                      <div className="slot-time">{slot}</div>
                      <div className="slot-status">
                        {activeSlot === slot ? '✓ Seleccionado' : 'Disponible'}
                      </div>
                    </button>
                  ))}
                </div>

                {/* Simulación del Split de Jugadores */}
                <div className="hcp-players-split">
                  <div className="hcp-players-title">
                    <span>Jugadores listos (4/4)</span>
                    <span className="text-[#39C54A] font-bold">
                      $ 9.000 / jugador
                    </span>
                  </div>
                  <div className="hcp-player-avatars">
                    <div className="hcp-avatar-item">
                      <div className="hcp-avatar paid">JM</div>
                      <span className="hcp-avatar-name">Juan</span>
                    </div>
                    <div className="hcp-avatar-item">
                      <div className="hcp-avatar paid">LC</div>
                      <span className="hcp-avatar-name">Lucas</span>
                    </div>
                    <div className="hcp-avatar-item">
                      <div className="hcp-avatar paid">MG</div>
                      <span className="hcp-avatar-name">Martín</span>
                    </div>
                    <div className="hcp-avatar-item">
                      <div className="hcp-avatar paid">PA</div>
                      <span className="hcp-avatar-name">Pablo</span>
                    </div>
                  </div>
                </div>

                <Link
                  to="/player"
                  className="w-full py-3.5 bg-[#39C54A] hover:bg-[#45dc57] text-slate-950 font-black rounded-xl text-center flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(57,197,74,0.3)] transition-all"
                >
                  <Zap className="h-4 w-4 fill-slate-950" />
                  Confirmar turno para las {activeSlot}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== LIVE REAL CAPABILITIES MARQUEE TICKER ===== */}
      <section className="ticker-section">
        <div className="ticker-wrapper">
          <div className="ticker-items">
            <div className="ticker-item">
              <Zap className="ticker-icon" />
              <span>GRILLA EN TIEMPO REAL:</span>
              <span className="ticker-val">BLOQUEO ATÓMICO ANTI-OVERBOOKING</span>
            </div>
            <div className="ticker-item">
              <Users className="ticker-icon" />
              <span>CUENTA DEL TURNO:</span>
              <span className="ticker-val">SPLIT EXACTO 4 JUGADORES</span>
            </div>
            <div className="ticker-item">
              <BarChart3 className="ticker-icon" />
              <span>MOTOR CONTABLE:</span>
              <span className="ticker-val">EERR DEVENGADO Y REAL</span>
            </div>
            <div className="ticker-item">
              <ShieldCheck className="ticker-icon" />
              <span>CIERRE DE CAJA:</span>
              <span className="ticker-val">ARQUEO DIARIO EN 1 CLICK</span>
            </div>
            <div className="ticker-item">
              <UtensilsCrossed className="ticker-icon" />
              <span>BUFFET & TIENDA:</span>
              <span className="ticker-val">DESCUENTO DE STOCK EN VIVO</span>
            </div>
            <div className="ticker-item">
              <Calendar className="ticker-icon" />
              <span>TURNOS FIJOS:</span>
              <span className="ticker-val">TARIFAS PROGRAMADAS</span>
            </div>
          </div>
          <div className="ticker-items" aria-hidden="true">
            <div className="ticker-item">
              <Zap className="ticker-icon" />
              <span>GRILLA EN TIEMPO REAL:</span>
              <span className="ticker-val">BLOQUEO ATÓMICO ANTI-OVERBOOKING</span>
            </div>
            <div className="ticker-item">
              <Users className="ticker-icon" />
              <span>CUENTA DEL TURNO:</span>
              <span className="ticker-val">SPLIT EXACTO 4 JUGADORES</span>
            </div>
            <div className="ticker-item">
              <BarChart3 className="ticker-icon" />
              <span>MOTOR CONTABLE:</span>
              <span className="ticker-val">EERR DEVENGADO Y REAL</span>
            </div>
            <div className="ticker-item">
              <ShieldCheck className="ticker-icon" />
              <span>CIERRE DE CAJA:</span>
              <span className="ticker-val">ARQUEO DIARIO EN 1 CLICK</span>
            </div>
            <div className="ticker-item">
              <UtensilsCrossed className="ticker-icon" />
              <span>BUFFET & TIENDA:</span>
              <span className="ticker-val">DESCUENTO DE STOCK EN VIVO</span>
            </div>
            <div className="ticker-item">
              <Calendar className="ticker-icon" />
              <span>TURNOS FIJOS:</span>
              <span className="ticker-val">TARIFAS PROGRAMADAS</span>
            </div>
          </div>
        </div>
      </section>

      {/* ===== DUAL EXPERIENCE (JUGADORES VS CLUBES) ===== */}
      <section id="experiencia" className="dual-experience">
        <div className="container">
          <div className="section-header-center">
            <span className="section-tag">Experiencia 360°</span>
            <h2 className="section-heading">Diseñado tanto para jugar como para liderar</h2>
            <p className="section-desc">
              Una solución unificada. Máxima agilidad para el jugador que busca cancha, y control
              financiero total para el dueño de complejo.
            </p>
          </div>

          <div className="dual-grid">
            {/* Card Jugador */}
            <div className="dual-card">
              <div>
                <div className="dual-header">
                  <div className="dual-icon-box">
                    <Trophy className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="dual-title">Para Jugadores</h3>
                    <p className="text-xs text-slate-400">Reserva veloz sin fricciones</p>
                  </div>
                </div>

                <p className="text-sm text-slate-300 leading-relaxed">
                  Buscá canchas disponibles en tu zona en tiempo real. Confirmá tu turno al instante
                  y olvidate de llamar por teléfono o esperar mensajes sin respuesta.
                </p>

                <div className="dual-list">
                  <div className="dual-list-item">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Disponibilidad exacta en tiempo real sin overbooking</span>
                  </div>
                  <div className="dual-list-item">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Pago dividido transparente entre los 4 compañeros</span>
                  </div>
                  <div className="dual-list-item">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Recordatorios por WhatsApp y confirmación instantánea</span>
                  </div>
                </div>
              </div>

              <Link
                to="/player"
                className="w-full py-3.5 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl text-center flex items-center justify-center gap-2 border border-white/15 transition-all"
              >
                Buscar Canchas Libres
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            {/* Card Club */}
            <div className="dual-card featured">
              <div>
                <div className="dual-header">
                  <div className="dual-icon-box">
                    <BarChart3 className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="dual-title">Para Complejos & Clubes</h3>
                    <p className="text-xs text-[#39C54A] font-semibold">El SaaS deportivo más potente</p>
                  </div>
                </div>

                <p className="text-sm text-slate-300 leading-relaxed">
                  Grilla de recepción, caja sincronizada, cuenta por turno, buffet con stock y Estado
                  de Resultados automático por unidad de negocio.
                </p>

                <div className="dual-list">
                  <div className="dual-list-item">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Grilla de reservas sincronizada con el portal público</span>
                  </div>
                  <div className="dual-list-item">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Arqueo de caja y cobros multi-medio con trazabilidad total</span>
                  </div>
                  <div className="dual-list-item">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>EERR en vivo y flujo de caja proyectado a 90 días</span>
                  </div>
                </div>
              </div>

              <Link
                to="/login"
                className="w-full py-3.5 bg-[#39C54A] hover:bg-[#45dc57] text-slate-950 font-black rounded-xl text-center flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(57,197,74,0.3)] transition-all"
              >
                Ingresar al Panel de Gestión
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ===== INTERACTIVE FEATURES SHOWCASE TABS ===== */}
      <section id="funcionalidades" className="features-interactive">
        <div className="container">
          <div className="section-header-center">
            <span className="section-tag">Panel Inteligente</span>
            <h2 className="section-heading">Cada detalle del club bajo control</h2>
            <p className="section-desc">
              Explorá cómo MatchGo unifica la operación de cancha, el mostrador y las finanzas
              sin esfuerzo manual.
            </p>
          </div>

          {/* Navigation Pill Tabs */}
          <div className="tab-nav-wrapper">
            {featureTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveFeatureTab(tab.id)}
                className={`tab-pill-btn ${activeFeatureTab === tab.id ? 'active' : ''}`}
              >
                {tab.id === 0 && <Calendar className="h-4 w-4" />}
                {tab.id === 1 && <Users className="h-4 w-4" />}
                {tab.id === 2 && <BarChart3 className="h-4 w-4" />}
                {tab.id === 3 && <UtensilsCrossed className="h-4 w-4" />}
                {tab.id === 0 && 'Grilla & Reservas'}
                {tab.id === 1 && 'Cuenta del Turno'}
                {tab.id === 2 && 'Finanzas & EERR'}
                {tab.id === 3 && 'Buffet & Stock'}
              </button>
            ))}
          </div>

          {/* Tab Card Display */}
          {(() => {
            const currentTab = (featureTabs[activeFeatureTab] ?? featureTabs[0])!;
            return (
              <div className="tab-display-card">
                <div className="tab-grid">
                  {/* Text / Bullets */}
                  <div>
                    <span className="inline-block px-3 py-1 bg-[#39C54A]/10 border border-[#39C54A]/30 text-[#39C54A] text-[11px] font-extrabold uppercase rounded-full tracking-wider mb-3">
                      {currentTab.badge}
                    </span>
                    <h3 className="text-2xl md:text-3xl font-black text-white leading-snug">
                      {currentTab.title}
                    </h3>
                    <p className="text-sm text-slate-300 mt-3 leading-relaxed">
                      {currentTab.desc}
                    </p>

                    <div className="tab-bullets">
                      {currentTab.bullets.map((b, idx) => (
                        <div key={idx} className="tab-bullet-item">
                          <div className="tab-bullet-icon">
                            <CheckCircle2 className="h-4 w-4" />
                          </div>
                          <div>
                            <h4 className="tab-bullet-title">{b.title}</h4>
                            <p className="tab-bullet-desc">{b.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

              {/* Interactive Visual Box */}
              <div className="tab-visual-box">
                {activeFeatureTab === 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between pb-3 border-b border-white/10">
                      <span className="text-xs font-bold text-slate-300">
                        Grilla del día · Canchas Principales
                      </span>
                      <span className="text-[11px] font-bold text-[#39C54A] flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#39C54A] animate-ping" />
                        Sincronizado
                      </span>
                    </div>
                    <div className="space-y-2">
                      <div className="p-3 bg-white/5 border border-white/10 rounded-xl flex items-center justify-between">
                        <div>
                          <p className="text-sm font-bold text-white">18:00 – Cancha Panorámica 1</p>
                          <p className="text-xs text-slate-400">Torneo Q2 · 90 min</p>
                        </div>
                        <span className="px-2.5 py-1 bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[11px] font-bold rounded-lg">
                          En curso
                        </span>
                      </div>
                      <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center justify-between">
                        <div>
                          <p className="text-sm font-bold text-white">19:30 – Cancha Cristal 2</p>
                          <p className="text-xs text-slate-400">Juan M. · 4 pagaron</p>
                        </div>
                        <span className="px-2.5 py-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[11px] font-bold rounded-lg">
                          Cobrado $36.000
                        </span>
                      </div>
                      <div className="p-3 bg-white/5 border border-white/10 rounded-xl flex items-center justify-between">
                        <div>
                          <p className="text-sm font-bold text-white">21:00 – Cancha Techada 3</p>
                          <p className="text-xs text-slate-400">Clase Particular · Prof. Leo</p>
                        </div>
                        <span className="px-2.5 py-1 bg-sky-500/20 text-sky-300 border border-sky-500/30 text-[11px] font-bold rounded-lg">
                          Programado
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {activeFeatureTab === 1 && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-white/10">
                      <span className="text-xs font-bold text-slate-300">
                        Simulador de Cuenta & Split Interactivo
                      </span>
                      <span className="text-xs font-black text-[#39C54A]">
                        Total: ${totalMatchBill.toLocaleString('es-AR')}
                      </span>
                    </div>

                    {/* Consumos interactivos */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs p-2 bg-white/5 rounded-lg">
                        <span className="text-slate-300">Alquiler Cancha (90 min)</span>
                        <span className="font-bold text-white">${courtPrice.toLocaleString('es-AR')}</span>
                      </div>

                      <div className="flex items-center justify-between text-xs p-2 bg-white/5 rounded-lg">
                        <span className="text-slate-300">Bebidas isotónicas (${beveragePrice} c/u)</span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setBeverageCount(Math.max(0, beverageCount - 1))}
                            className="w-5 h-5 rounded bg-white/10 text-white font-bold flex items-center justify-center cursor-pointer"
                          >
                            -
                          </button>
                          <span className="font-bold text-white">{beverageCount}</span>
                          <button
                            type="button"
                            onClick={() => setBeverageCount(beverageCount + 1)}
                            className="w-5 h-5 rounded bg-white/10 text-white font-bold flex items-center justify-center cursor-pointer"
                          >
                            +
                          </button>
                          <span className="font-bold text-[#39C54A] ml-2">
                            ${(beverageCount * beveragePrice).toLocaleString('es-AR')}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs p-2 bg-white/5 rounded-lg">
                        <span className="text-slate-300">Tubo de Pelotas Dunlop (${ballPrice} c/u)</span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setBallCount(Math.max(0, ballCount - 1))}
                            className="w-5 h-5 rounded bg-white/10 text-white font-bold flex items-center justify-center cursor-pointer"
                          >
                            -
                          </button>
                          <span className="font-bold text-white">{ballCount}</span>
                          <button
                            type="button"
                            onClick={() => setBallCount(ballCount + 1)}
                            className="w-5 h-5 rounded bg-white/10 text-white font-bold flex items-center justify-center cursor-pointer"
                          >
                            +
                          </button>
                          <span className="font-bold text-[#39C54A] ml-2">
                            ${(ballCount * ballPrice).toLocaleString('es-AR')}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Split 4 personas */}
                    <div className="p-3 bg-gradient-to-r from-emerald-500/20 to-lime-500/10 border border-emerald-500/30 rounded-xl flex items-center justify-between">
                      <div>
                        <p className="text-xs font-bold text-white">Monto exacto por jugador (÷ 4)</p>
                        <p className="text-[11px] text-slate-300">
                          Cada jugador paga en su propio medio de pago
                        </p>
                      </div>
                      <span className="text-lg font-black text-[#D9F23B]">
                        ${perPlayerBill.toLocaleString('es-AR')}
                      </span>
                    </div>
                  </div>
                )}

                {activeFeatureTab === 2 && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-white/10">
                      <span className="text-xs font-bold text-slate-300">
                        Estado de Resultados en Vivo
                      </span>
                      <span className="text-xs font-bold text-emerald-400">+18% vs mes anterior</span>
                    </div>

                    <div className="space-y-2.5">
                      <div>
                        <div className="flex justify-between text-xs mb-1 font-semibold">
                          <span className="text-slate-300">Alquiler Canchas</span>
                          <span className="text-white">$ 4.250.000</span>
                        </div>
                        <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-[#39C54A] rounded-full" style={{ width: '85%' }} />
                        </div>
                      </div>

                      <div>
                        <div className="flex justify-between text-xs mb-1 font-semibold">
                          <span className="text-slate-300">Buffet & Tienda</span>
                          <span className="text-white">$ 1.840.000</span>
                        </div>
                        <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-amber-400 rounded-full" style={{ width: '55%' }} />
                        </div>
                      </div>

                      <div>
                        <div className="flex justify-between text-xs mb-1 font-semibold">
                          <span className="text-slate-300">Clases y Escuelita</span>
                          <span className="text-white">$ 960.000</span>
                        </div>
                        <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-sky-400 rounded-full" style={{ width: '35%' }} />
                        </div>
                      </div>
                    </div>

                    <div className="p-3 bg-white/5 border border-white/10 rounded-xl flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-300">Resultado Neto del Período</span>
                      <span className="text-base font-black text-[#39C54A]">+$ 2.140.800</span>
                    </div>
                  </div>
                )}

                {activeFeatureTab === 3 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between pb-3 border-b border-white/10">
                      <span className="text-xs font-bold text-slate-300">
                        POS Rápido de Buffet & Stock
                      </span>
                      <span className="text-xs font-bold text-slate-400">Stock activo</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-2.5 bg-white/5 border border-white/10 rounded-xl">
                        <p className="text-xs font-bold text-white">Gatorade 500ml</p>
                        <p className="text-[11px] text-[#39C54A] font-bold mt-1">$ 2.500</p>
                        <span className="text-[10px] text-slate-400">Stock: 48 un.</span>
                      </div>
                      <div className="p-2.5 bg-white/5 border border-white/10 rounded-xl">
                        <p className="text-xs font-bold text-white">Tubo Head Pro</p>
                        <p className="text-[11px] text-[#39C54A] font-bold mt-1">$ 4.500</p>
                        <span className="text-[10px] text-amber-400 font-medium">Stock: 4 un. (Bajo)</span>
                      </div>
                      <div className="p-2.5 bg-white/5 border border-white/10 rounded-xl">
                        <p className="text-xs font-bold text-white">Overgrip Bullpadel</p>
                        <p className="text-[11px] text-[#39C54A] font-bold mt-1">$ 1.800</p>
                        <span className="text-[10px] text-slate-400">Stock: 30 un.</span>
                      </div>
                      <div className="p-2.5 bg-white/5 border border-white/10 rounded-xl">
                        <p className="text-xs font-bold text-white">Agua Mineral</p>
                        <p className="text-[11px] text-[#39C54A] font-bold mt-1">$ 1.500</p>
                        <span className="text-[10px] text-slate-400">Stock: 64 un.</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
            );
          })()}
        </div>
      </section>

      {/* ===== SPORTS BENTO SECTION ===== */}
      <section className="sports-bento">
        <div className="container">
          <div className="section-header-center">
            <span className="section-tag">Deportes de Raqueta</span>
            <h2 className="section-heading">Especializado en Pádel y Tenis</h2>
            <p className="section-desc">
              Reglas, duraciones, iluminación y superficies adaptadas a cada disciplina.
            </p>
          </div>

          <div className="bento-grid">
            <div className="bento-card">
              <img src="/assets/act-padel-a.jpg" alt="Pádel MatchGo" />
              <div className="bento-overlay">
                <h3 className="bento-title">Canchas de Pádel</h3>
                <p className="bento-desc">
                  Cristal, muro, techadas o al aire libre con control de turnos de 90 min y suplementos nocturnos.
                </p>
                <Link to="/player" className="text-xs font-bold text-[#39C54A] flex items-center gap-1">
                  Ver canchas de pádel <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>

            <div className="bento-card">
              <img src="/assets/act-tennis-b.jpg" alt="Tenis MatchGo" />
              <div className="bento-overlay">
                <h3 className="bento-title">Canchas de Tenis</h3>
                <p className="bento-desc">
                  Polvo de ladrillo, cemento rápido o césped sintético con soporte para singles y dobles.
                </p>
                <Link to="/player" className="text-xs font-bold text-[#39C54A] flex items-center gap-1">
                  Ver canchas de tenis <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== KINETIC PADEL SCROLL REVEAL (GSAP ANIMATION) ===== */}
      <PadelScrollReveal />

      {/* ===== FAQ SECTION ===== */}
      <section id="faq" className="faq-section">
        <div className="container">
          <div className="section-header-center">
            <span className="section-tag">Dudas Frecuentes</span>
            <h2 className="section-heading">Todo lo que necesitás saber</h2>
            <p className="section-desc">
              Respuestas directas sobre la reserva para jugadores y la implementación para clubes.
            </p>
          </div>

          <div className="faq-wrapper">
            {faqs.map((f, i) => (
              <div key={i} className={`faq-card ${openFaq === i ? 'open' : ''}`}>
                <button
                  type="button"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="faq-trigger"
                >
                  <span>{f.q}</span>
                  <ChevronDown className="h-5 w-5 faq-chevron" />
                </button>
                {openFaq === i && <div className="faq-content">{f.a}</div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer className="landing-footer">
        <div className="container">
          <div className="footer-top">
            <div>
              <Link to="/" className="nav-logo">
                <img src="/assets/matchgo_logo.svg" alt="MatchGo" />
              </Link>
              <p className="footer-brand-p">
                La plataforma deportiva líder en reservas y gestión para clubes de pádel y tenis.
              </p>
            </div>

            <div>
              <h4 className="footer-col-title">Jugadores</h4>
              <div className="footer-links">
                <Link to="/player" className="footer-link-a">
                  Reservar Cancha
                </Link>
                <Link to="/player" className="footer-link-a">
                  Explorar Clubes
                </Link>
                <Link to="/login" className="footer-link-a">
                  Iniciar Sesión
                </Link>
              </div>
            </div>

            <div>
              <h4 className="footer-col-title">Clubes & SaaS</h4>
              <div className="footer-links">
                <a href="#funcionalidades" className="footer-link-a">
                  Grilla de Reservas
                </a>
                <a href="#funcionalidades" className="footer-link-a">
                  Cuenta del Turno
                </a>
                <a href="#funcionalidades" className="footer-link-a">
                  Finanzas & EERR
                </a>
                <Link to="/login" className="footer-link-a">
                  Acceso Administrador
                </Link>
              </div>
            </div>

            <div>
              <h4 className="footer-col-title">Contacto</h4>
              <div className="footer-links">
                <a href="mailto:hola@matchgo.ar" className="footer-link-a">
                  hola@matchgo.ar
                </a>
                <span className="text-xs text-slate-500">Buenos Aires, Argentina</span>
              </div>
            </div>
          </div>

          <div className="footer-bottom">
            <span>© 2026 MatchGo. Todos los derechos reservados.</span>
            <span className="text-slate-500">Hecho con pasión por el deporte</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
