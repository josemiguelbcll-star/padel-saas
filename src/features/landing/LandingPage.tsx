import './landing.css';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Clock,
  Layers,
  MapPin,
  Menu,
  Package,
  Receipt,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Trophy,
  Users,
  UtensilsCrossed,
  Wallet,
  X,
} from 'lucide-react';

import { PadelScrollReveal } from './PadelScrollReveal';

export function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  // Hero Floating Search Bar state (Default ciudad: Salta)
  const [selectedCity, setSelectedCity] = useState('Salta');
  const [selectedSport, setSelectedSport] = useState<'padel' | 'tenis'>('padel');
  const [selectedDate, setSelectedDate] = useState('Hoy 02/09');
  const [selectedTime, setSelectedTime] = useState('19:30hs');
  const [activeSlot, setActiveSlot] = useState<string>('19:30');
  
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
      previewType: 'grilla' as const,
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
      previewType: 'cuenta' as const,
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
      previewType: 'finanzas' as const,
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
      previewType: 'buffet' as const,
    },
  ];

  const currentFeature = (featureTabs[activeFeatureTab] ?? featureTabs[0])!;

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
      {/* ===== NAV BAR (Warm Bone & MatchGo Branding) ===== */}
      <header className="nav-bar">
        <div className="container">
          <div className="nav-content">
            <Link to="/" className="flex items-center">
              <img src="/matchgo_logo.svg" alt="MatchGo" className="h-8 w-auto object-contain" />
            </Link>

            <nav className="nav-menu">
              <Link to="/player" className="nav-link">
                🎾 Reservar Cancha
              </Link>
              <a href="#experiencia" className="nav-link">
                Experiencia en Vivo
              </a>
              <a href="#funcionalidades" className="nav-link">
                Funcionalidades
              </a>
              <a href="#faq" className="nav-link">
                Preguntas
              </a>
            </nav>

            <div className="nav-actions">
              <Link to="/login" className="btn-club-badge">
                <Trophy className="h-4 w-4" />
                Software para clubes
              </Link>
              <Link to="/login" className="btn-nav-login">
                <span>Acceder</span>
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
          <div className="md:hidden border-t border-[#E2DDD1] bg-[#F4F2EB] p-6 space-y-4 shadow-xl">
            <Link
              to="/player"
              className="block font-semibold text-slate-900 text-lg"
              onClick={() => setMobileMenuOpen(false)}
            >
              🎾 Reservar Cancha (Jugadores)
            </Link>
            <a
              href="#funcionalidades"
              className="block text-slate-700 font-medium"
              onClick={() => setMobileMenuOpen(false)}
            >
              ⚙️ Software para Clubes
            </a>
            <a
              href="#faq"
              className="block text-slate-700 font-medium"
              onClick={() => setMobileMenuOpen(false)}
            >
              ❓ Preguntas Frecuentes
            </a>
            <div className="pt-4 flex flex-col gap-3">
              <Link
                to="/player"
                className="btn-club-badge justify-center text-center py-3"
                onClick={() => setMobileMenuOpen(false)}
              >
                Buscar Canchas Online
              </Link>
              <Link
                to="/login"
                className="btn-nav-login justify-center text-center py-3"
                onClick={() => setMobileMenuOpen(false)}
              >
                Acceso Administrador del Club
              </Link>
            </div>
          </div>
        )}
      </header>

      {/* ===== HERO SECTION (Warm Bone with Floating Search Bar) ===== */}
      <section className="hero-section">
        <div className="hero-court-bg" />
        <div className="container relative z-10">
          <div className="max-w-3xl mb-8">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white border border-[#A7F3D0] text-[#00A859] text-xs font-bold uppercase tracking-wider mb-5 shadow-sm">
              <Sparkles className="h-3.5 w-3.5" />
              Portal de Reservas & Software para Clubes
            </div>

            <h1 className="hero-title-emerald">
              Reserva tu cancha <br />
              <span className="text-slate-900">al instante</span>
            </h1>

            <p className="hero-subtitle">
              Explorá las canchas disponibles en tu ciudad y en tiempo real. 
              Para clubes, la plataforma de gestión más completa con grilla, cobros y finanzas.
            </p>
          </div>

          {/* Floating Search Bar with Salta by default */}
          <div className="floating-search-bar">
            {/* 1. Ciudad (Salta Default) */}
            <div className="search-item">
              <MapPin className="search-item-icon h-4 w-4" />
              <div>
                <p className="text-[10px] uppercase font-bold text-slate-400 leading-none">Ciudad</p>
                <select
                  value={selectedCity}
                  onChange={(e) => setSelectedCity(e.target.value)}
                  className="bg-transparent font-bold text-xs sm:text-sm text-slate-800 outline-none cursor-pointer"
                >
                  <option value="Salta">Salta</option>
                  <option value="Buenos Aires">Buenos Aires</option>
                  <option value="Córdoba">Córdoba</option>
                  <option value="Rosario">Rosario</option>
                  <option value="Mendoza">Mendoza</option>
                  <option value="Tucumán">Tucumán</option>
                </select>
              </div>
            </div>

            <div className="search-divider" />

            {/* 2. Deporte */}
            <div className="search-item">
              <Trophy className="search-item-icon h-4 w-4" />
              <div>
                <p className="text-[10px] uppercase font-bold text-slate-400 leading-none">Deporte</p>
                <select
                  value={selectedSport}
                  onChange={(e) => setSelectedSport(e.target.value as 'padel' | 'tenis')}
                  className="bg-transparent font-bold text-xs sm:text-sm text-slate-800 outline-none cursor-pointer"
                >
                  <option value="padel">Pádel</option>
                  <option value="tenis">Tenis</option>
                </select>
              </div>
            </div>

            <div className="search-divider" />

            {/* 3. Fecha */}
            <div className="search-item">
              <Calendar className="search-item-icon h-4 w-4" />
              <div>
                <p className="text-[10px] uppercase font-bold text-slate-400 leading-none">Fecha</p>
                <select
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="bg-transparent font-bold text-xs sm:text-sm text-slate-800 outline-none cursor-pointer"
                >
                  <option value="Hoy 02/09">Hoy 02/09</option>
                  <option value="Mañana 03/09">Mañana 03/09</option>
                  <option value="Viernes 05/09">Viernes 05/09</option>
                  <option value="Sábado 06/09">Sábado 06/09</option>
                </select>
              </div>
            </div>

            <div className="search-divider" />

            {/* 4. Horario */}
            <div className="search-item">
              <Clock className="search-item-icon h-4 w-4" />
              <div>
                <p className="text-[10px] uppercase font-bold text-slate-400 leading-none">Horario</p>
                <select
                  value={selectedTime}
                  onChange={(e) => {
                    setSelectedTime(e.target.value);
                    setActiveSlot(e.target.value.replace('hs', ''));
                  }}
                  className="bg-transparent font-bold text-xs sm:text-sm text-slate-800 outline-none cursor-pointer"
                >
                  <option value="11:30hs">11:30hs</option>
                  <option value="18:00hs">18:00hs</option>
                  <option value="19:30hs">19:30hs</option>
                  <option value="21:00hs">21:00hs</option>
                </select>
              </div>
            </div>

            {/* 5. Botón de Acción */}
            <Link to="/player" className="btn-search-action active">
              <Search className="h-4 w-4" />
              Buscar canchas
            </Link>
          </div>

          {/* Visual Interactive Demo (Court Simulation Card) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-7">
              <div className="grilla-simulator p-6">
                <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-6">
                  <div>
                    <span className="pill-badge mb-1">
                      <span className="w-2 h-2 rounded-full bg-[#00A859] animate-pulse" />
                      Disponibilidad en Vivo ({selectedCity})
                    </span>
                    <h4 className="font-extrabold text-base text-slate-900">
                      Club Central Padel · {selectedDate}
                    </h4>
                  </div>
                  <span className="text-xs font-semibold px-3 py-1 rounded-lg bg-slate-100 text-slate-600">
                    4 Canchas de Cristal
                  </span>
                </div>

                {/* Slots Grid */}
                <div className="space-y-3">
                  <div className="grid grid-cols-4 gap-2">
                    <div className="text-xs font-bold text-slate-400 text-center">Cancha 1</div>
                    <div className="text-xs font-bold text-slate-400 text-center">Cancha 2</div>
                    <div className="text-xs font-bold text-slate-400 text-center">Cancha 3</div>
                    <div className="text-xs font-bold text-slate-400 text-center">Cancha 4</div>
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveSlot('18:00')}
                      className={`slot-pill disponible ${activeSlot === '18:00' ? 'active' : ''}`}
                    >
                      18:00
                    </button>
                    <div className="slot-pill ocupado">18:00</div>
                    <button
                      type="button"
                      onClick={() => setActiveSlot('18:00')}
                      className={`slot-pill disponible ${activeSlot === '18:00' ? 'active' : ''}`}
                    >
                      18:00
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveSlot('18:00')}
                      className={`slot-pill disponible ${activeSlot === '18:00' ? 'active' : ''}`}
                    >
                      18:00
                    </button>
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveSlot('19:30')}
                      className={`slot-pill disponible ${activeSlot === '19:30' ? 'active' : ''}`}
                    >
                      19:30
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveSlot('19:30')}
                      className={`slot-pill disponible ${activeSlot === '19:30' ? 'active' : ''}`}
                    >
                      19:30
                    </button>
                    <div className="slot-pill ocupado">19:30</div>
                    <button
                      type="button"
                      onClick={() => setActiveSlot('19:30')}
                      className={`slot-pill disponible ${activeSlot === '19:30' ? 'active' : ''}`}
                    >
                      19:30
                    </button>
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    <div className="slot-pill ocupado">21:00</div>
                    <button
                      type="button"
                      onClick={() => setActiveSlot('21:00')}
                      className={`slot-pill disponible ${activeSlot === '21:00' ? 'active' : ''}`}
                    >
                      21:00
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveSlot('21:00')}
                      className={`slot-pill disponible ${activeSlot === '21:00' ? 'active' : ''}`}
                    >
                      21:00
                    </button>
                    <div className="slot-pill ocupado">21:00</div>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#00A859]" /> Franja de 90 min disponible
                  </div>
                  <Link
                    to="/player"
                    className="text-xs font-bold text-[#00A859] hover:underline flex items-center gap-1"
                  >
                    Confirmar en 1 click <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            </div>

            {/* Quick Metrics Cards */}
            <div className="lg:col-span-5 space-y-4">
              <div className="athletic-card border-[#A7F3D0]">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-bold text-[#008F4C] uppercase tracking-wider mb-1">
                      Cero Doble Reserva
                    </p>
                    <h4 className="text-lg font-black text-slate-900">
                      Bloqueo Atómico Anti-Overbooking
                    </h4>
                    <p className="text-xs text-slate-600 mt-1">
                      Al seleccionar una cancha, se bloquea en tiempo real para todos los demás jugadores.
                    </p>
                  </div>
                  <div className="p-3 bg-emerald-50 text-[#00A859] rounded-xl shadow-sm">
                    <ShieldCheck className="h-6 w-6" />
                  </div>
                </div>
              </div>

              <div className="athletic-card">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-1">
                      Cuenta del Turno
                    </p>
                    <h4 className="text-lg font-black text-slate-900">
                      Split Exacto 4 Jugadores
                    </h4>
                    <p className="text-xs text-slate-600 mt-1">
                      Cargá bebidas y pelotas y repartí la cuenta entre los integrantes al instante.
                    </p>
                  </div>
                  <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
                    <Users className="h-6 w-6" />
                  </div>
                </div>
              </div>

              <div className="athletic-card">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-1">
                      Cierre de Caja
                    </p>
                    <h4 className="text-lg font-black text-slate-900">
                      Arqueo Diario en 1 Click
                    </h4>
                    <p className="text-xs text-slate-600 mt-1">
                      Control estricto de efectivo, transferencias y trazabilidad de ingresos.
                    </p>
                  </div>
                  <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
                    <BarChart3 className="h-6 w-6" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== GSAP KINETIC SCROLL REVEAL (Bone Theme) ===== */}
      <section id="experiencia">
        <PadelScrollReveal />
      </section>

      {/* ===== INTERACTIVE MATCH BILL SPLIT DEMO ===== */}
      <section className="section-pearl">
        <div className="container">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-6 space-y-6">
              <span className="pill-badge">
                <UtensilsCrossed className="h-3.5 w-3.5" />
                Innovación Única
              </span>
              <h2 className="section-title">
                La cuenta del turno como en un restaurante
              </h2>
              <p className="section-desc">
                Se terminaron los cálculos a mano en el mostrador. Cargá el alquiler de la cancha,
                las bebidas frías y los tubos de pelotas en una sola cuenta compartida que se divide sola.
              </p>

              <div className="space-y-3 pt-2">
                <div className="flex items-center gap-3 text-sm font-semibold text-slate-700">
                  <CheckCircle2 className="h-5 w-5 text-[#00A859] shrink-0" />
                  <span>Suma alquiler base + consumos de buffet al mismo ticket</span>
                </div>
                <div className="flex items-center gap-3 text-sm font-semibold text-slate-700">
                  <CheckCircle2 className="h-5 w-5 text-[#00A859] shrink-0" />
                  <span>Cada jugador paga su parte con el medio de pago que elija</span>
                </div>
                <div className="flex items-center gap-3 text-sm font-semibold text-slate-700">
                  <CheckCircle2 className="h-5 w-5 text-[#00A859] shrink-0" />
                  <span>Fijación de cuota y redistribución automática si alguien paga de menos</span>
                </div>
              </div>
            </div>

            {/* Interactive Simulator Card */}
            <div className="lg:col-span-6">
              <div className="athletic-card p-6 border-2 border-emerald-500/20">
                <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-6">
                  <div>
                    <span className="text-xs font-bold text-slate-400 uppercase">Simulador en Vivo</span>
                    <h3 className="text-lg font-black text-slate-900">Partido Central · 19:30hs</h3>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-bold text-slate-400">Total a cobrar</span>
                    <p className="text-2xl font-black text-[#00A859] tabular-nums">
                      ${totalMatchBill.toLocaleString('es-AR')}
                    </p>
                  </div>
                </div>

                {/* Interactive Controls */}
                <div className="space-y-4 mb-6">
                  <div className="flex items-center justify-between bg-[#FAF9F5] p-3 rounded-xl border border-[#E2DDD1]">
                    <div>
                      <p className="text-xs font-bold text-slate-800">Alquiler Cancha (90 min)</p>
                      <p className="text-[11px] text-slate-500">Tarifa Tarde/Noche</p>
                    </div>
                    <span className="font-extrabold text-sm text-slate-900">$36.000</span>
                  </div>

                  <div className="flex items-center justify-between bg-[#FAF9F5] p-3 rounded-xl border border-[#E2DDD1]">
                    <div>
                      <p className="text-xs font-bold text-slate-800">Bebidas Isotónicas ($2.500 c/u)</p>
                      <p className="text-[11px] text-slate-500">{beverageCount} botellas agregadas</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setBeverageCount(Math.max(0, beverageCount - 1))}
                        className="w-7 h-7 rounded-lg bg-white border border-slate-300 font-black text-sm flex items-center justify-center hover:bg-slate-100"
                      >
                        -
                      </button>
                      <span className="w-6 text-center font-bold text-sm">{beverageCount}</span>
                      <button
                        type="button"
                        onClick={() => setBeverageCount(beverageCount + 1)}
                        className="w-7 h-7 rounded-lg bg-[#00A859] text-white font-black text-sm flex items-center justify-center hover:bg-[#008f4c]"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between bg-[#FAF9F5] p-3 rounded-xl border border-[#E2DDD1]">
                    <div>
                      <p className="text-xs font-bold text-slate-800">Tubo de Pelotas ($4.500 c/u)</p>
                      <p className="text-[11px] text-slate-500">{ballCount} tubos nuevos</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setBallCount(Math.max(0, ballCount - 1))}
                        className="w-7 h-7 rounded-lg bg-white border border-slate-300 font-black text-sm flex items-center justify-center hover:bg-slate-100"
                      >
                        -
                      </button>
                      <span className="w-6 text-center font-bold text-sm">{ballCount}</span>
                      <button
                        type="button"
                        onClick={() => setBallCount(ballCount + 1)}
                        className="w-7 h-7 rounded-lg bg-[#00A859] text-white font-black text-sm flex items-center justify-center hover:bg-[#008f4c]"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>

                {/* 4 Players Split Result */}
                <div className="bg-emerald-50/70 rounded-2xl p-4 border border-[#A7F3D0]">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold text-[#008F4C] uppercase">
                      División por Jugador (4 participantes)
                    </span>
                    <span className="text-lg font-black text-[#00A859] tabular-nums">
                      ${perPlayerBill.toLocaleString('es-AR')} <span className="text-xs font-medium text-slate-600">/ c/u</span>
                    </span>
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    {['Jugador 1', 'Jugador 2', 'Jugador 3', 'Jugador 4'].map((j, i) => (
                      <div key={j} className="bg-white p-2.5 rounded-xl text-center shadow-sm border border-emerald-100">
                        <div className="w-7 h-7 mx-auto rounded-full bg-emerald-100 text-[#00A859] font-black text-xs flex items-center justify-center mb-1">
                          {i + 1}
                        </div>
                        <p className="text-[10px] font-bold text-slate-700 truncate">{j}</p>
                        <p className="text-[11px] font-extrabold text-[#00A859] tabular-nums">
                          ${perPlayerBill.toLocaleString('es-AR')}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== FEATURE TABS (Dynamic Previews per Feature) ===== */}
      <section id="funcionalidades" className="section-light">
        <div className="container">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <span className="pill-badge mb-3">Módulos Especializados</span>
            <h2 className="section-title">
              Todo lo que necesita un club en una sola pantalla
            </h2>
            <p className="section-desc mx-auto">
              Diseñado exclusivamente para el ritmo de juego del pádel y tenis, donde cada minuto de cancha cuenta.
            </p>
          </div>

          {/* Tab Navigation */}
          <div className="flex flex-wrap justify-center gap-2 mb-12">
            {featureTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveFeatureTab(tab.id)}
                className={`px-5 py-3 rounded-full font-bold text-xs sm:text-sm transition-all cursor-pointer ${
                  activeFeatureTab === tab.id
                    ? 'bg-[#00A859] text-white shadow-lg shadow-emerald-500/25'
                    : 'bg-white text-slate-700 border border-[#E2DDD1] hover:bg-[#ECE8DE]'
                }`}
              >
                {tab.badge}
              </button>
            ))}
          </div>

          {/* Active Tab Content Card */}
          <div className="athletic-card max-w-5xl mx-auto p-8 lg:p-12 border border-[#E2DDD1]">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              {/* Left Column: Descriptions & Bullets */}
              <div className="lg:col-span-6 space-y-5">
                <span className="pill-badge">{currentFeature.badge}</span>
                <h3 className="text-2xl sm:text-3xl font-black text-slate-900">
                  {currentFeature.title}
                </h3>
                <p className="text-sm sm:text-base text-slate-600">
                  {currentFeature.desc}
                </p>

                <div className="space-y-3 pt-2">
                  {currentFeature.bullets.map((b) => (
                    <div key={b.title} className="flex items-start gap-3">
                      <CheckCircle2 className="h-5 w-5 text-[#00A859] shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-bold text-slate-900">{b.title}</p>
                        <p className="text-xs text-slate-500">{b.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Column: DYNAMIC PREVIEW TAILORED TO THE ACTIVE TAB */}
              <div className="lg:col-span-6">
                {/* 1. MOCKUP PARA GRILLA EN VIVO */}
                {currentFeature.previewType === 'grilla' && (
                  <div className="bg-[#FAF9F5] rounded-2xl p-5 border border-[#E2DDD1] shadow-inner space-y-3">
                    <div className="flex items-center justify-between pb-3 border-b border-[#E2DDD1]">
                      <div className="flex items-center gap-2">
                        <Layers className="h-4 w-4 text-[#00A859]" />
                        <span className="text-xs font-bold text-slate-800">Grilla Operativa · 4 Canchas</span>
                      </div>
                      <span className="text-[11px] font-extrabold px-2.5 py-0.5 rounded-full bg-emerald-100 text-[#008F4C]">
                        Anti-Solapamiento Activo
                      </span>
                    </div>

                    <div className="space-y-2">
                      <div className="bg-white p-3 rounded-xl border border-emerald-200 shadow-sm flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="w-2 h-2 rounded-full bg-[#00A859]" />
                            <p className="text-xs font-black text-slate-900">Cancha 1 (Cristal Pro) · 18:00 a 19:30</p>
                          </div>
                          <p className="text-[11px] text-slate-500">Turno Fijo: Agustín Álvarez · 4 Jugadores</p>
                        </div>
                        <span className="text-[11px] font-black px-2 py-0.5 rounded bg-emerald-50 text-[#00A859]">
                          PAGADO
                        </span>
                      </div>

                      <div className="bg-white p-3 rounded-xl border border-blue-200 shadow-sm flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="w-2 h-2 rounded-full bg-blue-500" />
                            <p className="text-xs font-black text-slate-900">Cancha 2 · 19:30 a 21:00</p>
                          </div>
                          <p className="text-[11px] text-slate-500">Clase Particular: Prof. Martín</p>
                        </div>
                        <span className="text-[11px] font-black px-2 py-0.5 rounded bg-blue-50 text-blue-600">
                          SEÑADO $10.000
                        </span>
                      </div>

                      <div className="bg-white p-3 rounded-xl border border-amber-200 shadow-sm flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="w-2 h-2 rounded-full bg-amber-500" />
                            <p className="text-xs font-black text-slate-900">Cancha 3 · 21:00 a 22:30</p>
                          </div>
                          <p className="text-[11px] text-slate-500">Reserva Web App · Rodrigo Díaz</p>
                        </div>
                        <span className="text-[11px] font-black px-2 py-0.5 rounded bg-amber-50 text-amber-600">
                          EN JUEGO
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. MOCKUP PARA DIVISIÓN DE PAGOS */}
                {currentFeature.previewType === 'cuenta' && (
                  <div className="bg-[#FAF9F5] rounded-2xl p-5 border border-[#E2DDD1] shadow-inner space-y-3">
                    <div className="flex items-center justify-between pb-3 border-b border-[#E2DDD1]">
                      <div className="flex items-center gap-2">
                        <Receipt className="h-4 w-4 text-[#00A859]" />
                        <span className="text-xs font-bold text-slate-800">Cuenta Turno #148 · Cancha 2</span>
                      </div>
                      <span className="text-xs font-black text-[#00A859]">Total: $50.500</span>
                    </div>

                    <div className="space-y-2 text-xs">
                      <div className="bg-white p-2.5 rounded-xl border border-slate-200 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-emerald-100 text-[#00A859] font-bold flex items-center justify-center text-[10px]">1</div>
                          <div>
                            <p className="font-bold text-slate-800">Agustín (Titular)</p>
                            <p className="text-[10px] text-slate-400">Efectivo</p>
                          </div>
                        </div>
                        <span className="font-bold text-[#00A859] bg-emerald-50 px-2 py-0.5 rounded text-[11px]">Pagó $12.625</span>
                      </div>

                      <div className="bg-white p-2.5 rounded-xl border border-slate-200 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-emerald-100 text-[#00A859] font-bold flex items-center justify-center text-[10px]">2</div>
                          <div>
                            <p className="font-bold text-slate-800">Matías</p>
                            <p className="text-[10px] text-slate-400">Transferencia</p>
                          </div>
                        </div>
                        <span className="font-bold text-[#00A859] bg-emerald-50 px-2 py-0.5 rounded text-[11px]">Pagó $12.625</span>
                      </div>

                      <div className="bg-white p-2.5 rounded-xl border border-amber-200 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-amber-100 text-amber-700 font-bold flex items-center justify-center text-[10px]">3</div>
                          <div>
                            <p className="font-bold text-slate-800">Lucas</p>
                            <p className="text-[10px] text-slate-400">Mercado Pago</p>
                          </div>
                        </div>
                        <span className="font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded text-[11px]">Debe $12.625</span>
                      </div>

                      <div className="bg-white p-2.5 rounded-xl border border-slate-200 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center text-[10px]">4</div>
                          <div>
                            <p className="font-bold text-slate-800">Rodrigo</p>
                            <p className="text-[10px] text-slate-400">Pagó consumos extra</p>
                          </div>
                        </div>
                        <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded text-[11px]">Cuota Fijada</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* 3. MOCKUP PARA FINANZAS & EERR */}
                {currentFeature.previewType === 'finanzas' && (
                  <div className="bg-[#FAF9F5] rounded-2xl p-5 border border-[#E2DDD1] shadow-inner space-y-3">
                    <div className="flex items-center justify-between pb-3 border-b border-[#E2DDD1]">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-[#00A859]" />
                        <span className="text-xs font-bold text-slate-800">Estado de Resultados Devengado</span>
                      </div>
                      <span className="text-[11px] font-extrabold text-[#008F4C] bg-emerald-100 px-2 py-0.5 rounded-full">
                        Margen +38.4%
                      </span>
                    </div>

                    <div className="space-y-2.5">
                      <div className="bg-white p-3 rounded-xl border border-slate-200">
                        <div className="flex justify-between text-xs font-bold text-slate-800 mb-1">
                          <span>Alquiler de Canchas (62%)</span>
                          <span>$2.480.000</span>
                        </div>
                        <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                          <div className="bg-[#00A859] h-full rounded-full" style={{ width: '62%' }} />
                        </div>
                      </div>

                      <div className="bg-white p-3 rounded-xl border border-slate-200">
                        <div className="flex justify-between text-xs font-bold text-slate-800 mb-1">
                          <span>Buffet & Bebidas (24%)</span>
                          <span>$980.000</span>
                        </div>
                        <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                          <div className="bg-blue-500 h-full rounded-full" style={{ width: '24%' }} />
                        </div>
                      </div>

                      <div className="bg-white p-3 rounded-xl border border-slate-200">
                        <div className="flex justify-between text-xs font-bold text-slate-800 mb-1">
                          <span>Clases & Profesores (14%)</span>
                          <span>$540.000</span>
                        </div>
                        <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                          <div className="bg-amber-500 h-full rounded-full" style={{ width: '14%' }} />
                        </div>
                      </div>

                      <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between text-xs font-bold text-[#008F4C]">
                        <span className="flex items-center gap-1.5">
                          <Wallet className="h-4 w-4" /> Arqueo de Caja del Día
                        </span>
                        <span>$0.00 Diferencia (Cuadrado)</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* 4. MOCKUP PARA BUFFET & POS */}
                {currentFeature.previewType === 'buffet' && (
                  <div className="bg-[#FAF9F5] rounded-2xl p-5 border border-[#E2DDD1] shadow-inner space-y-3">
                    <div className="flex items-center justify-between pb-3 border-b border-[#E2DDD1]">
                      <div className="flex items-center gap-2">
                        <Package className="h-4 w-4 text-[#00A859]" />
                        <span className="text-xs font-bold text-slate-800">Mostrador POS & Control de Stock</span>
                      </div>
                      <span className="text-[11px] font-bold text-slate-500">Descuento en vivo</span>
                    </div>

                    <div className="space-y-2 text-xs">
                      <div className="bg-white p-3 rounded-xl border border-slate-200 flex items-center justify-between shadow-sm">
                        <div className="flex items-center gap-2.5">
                          <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600 font-black">🥤</div>
                          <div>
                            <p className="font-bold text-slate-800">Gatorade Blue 500ml</p>
                            <p className="text-[11px] text-slate-500">Stock: 48 unidades</p>
                          </div>
                        </div>
                        <span className="font-black text-slate-900">$2.500</span>
                      </div>

                      <div className="bg-white p-3 rounded-xl border border-slate-200 flex items-center justify-between shadow-sm">
                        <div className="flex items-center gap-2.5">
                          <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 font-black">🎾</div>
                          <div>
                            <p className="font-bold text-slate-800">Tubo Bullpadel Gold x3</p>
                            <p className="text-[11px] text-slate-500">Stock: 16 unidades</p>
                          </div>
                        </div>
                        <span className="font-black text-slate-900">$4.500</span>
                      </div>

                      <div className="bg-white p-3 rounded-xl border border-rose-200 flex items-center justify-between shadow-sm">
                        <div className="flex items-center gap-2.5">
                          <div className="p-1.5 rounded-lg bg-rose-50 text-rose-600 font-black">⚡</div>
                          <div>
                            <p className="font-bold text-slate-800">Grip Wilson Pro Comfort</p>
                            <p className="text-[11px] text-rose-600 font-bold">⚠️ Stock bajo: 3 unidades</p>
                          </div>
                        </div>
                        <span className="font-black text-slate-900">$1.800</span>
                      </div>

                      <div className="p-2.5 rounded-xl bg-slate-900 text-white flex items-center justify-between text-xs font-bold">
                        <span>Ticket Mostrador: 2 Gatorades + 1 Tubo</span>
                        <span className="text-[#00A859] font-black">$9.500 [COBRAR]</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== FAQ SECTION ===== */}
      <section id="faq" className="section-light">
        <div className="container max-w-4xl">
          <div className="text-center mb-12">
            <span className="pill-badge mb-3">Dudas Frecuentes</span>
            <h2 className="section-title">Preguntas sobre MatchGo</h2>
          </div>

          <div className="space-y-3">
            {faqs.map((faq, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div
                  key={faq.q}
                  className={`athletic-card p-5 cursor-pointer transition-all ${
                    isOpen ? 'border-[#00A859] shadow-md' : 'hover:border-slate-300'
                  }`}
                  onClick={() => setOpenFaq(isOpen ? null : idx)}
                >
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-sm sm:text-base text-slate-900">{faq.q}</h4>
                    <ChevronDown
                      className={`h-5 w-5 text-slate-400 transition-transform ${
                        isOpen ? 'rotate-180 text-[#00A859]' : ''
                      }`}
                    />
                  </div>
                  {isOpen && (
                    <p className="text-xs sm:text-sm text-slate-600 mt-3 pt-3 border-t border-slate-100 leading-relaxed">
                      {faq.a}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ===== FINAL CALL TO ACTION (Warm Bone & Light Gray Container) ===== */}
      <section className="section-light py-16">
        <div className="container max-w-4xl">
          <div className="rounded-3xl bg-[#ECE8DE] text-slate-900 p-10 sm:p-14 text-center shadow-lg border border-[#E2DDD1] relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(0,168,89,0.1),transparent_70%)] pointer-events-none" />
            
            <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white text-[#00A859] text-xs font-bold uppercase tracking-wider mb-6 border border-[#A7F3D0] shadow-sm">
              <Sparkles className="h-3.5 w-3.5" />
              Tu Club al Siguiente Nivel
            </span>

            <h2 className="text-3xl sm:text-5xl font-black tracking-tight mb-4 text-slate-900">
              Gestioná tu club con <span className="text-[#00A859]">MatchGo</span>
            </h2>
            <p className="text-sm sm:text-base text-slate-600 max-w-xl mx-auto mb-8 leading-relaxed">
              Unite a los complejos deportivos que ya automatizaron sus turnos, simplificaron sus cobros en mostrador y tienen finanzas transparentes.
            </p>

            <div className="flex flex-wrap justify-center gap-4 relative z-10">
              <Link
                to="/player"
                className="px-8 py-3.5 rounded-full bg-[#00A859] hover:bg-[#008F4C] text-white font-black text-sm transition-all shadow-lg shadow-emerald-500/25 flex items-center gap-2"
              >
                <span>🎾 Probar Reserva Online</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/login"
                className="px-8 py-3.5 rounded-full bg-white hover:bg-[#FAF9F5] text-slate-800 font-bold text-sm transition-all border border-[#E2DDD1] shadow-sm"
              >
                🏢 Acceso Administrador Club
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ===== FOOTER (Warm Bone Theme) ===== */}
      <footer className="footer-light">
        <div className="container">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-12">
            <div className="space-y-3">
              <Link to="/" className="inline-block mb-1">
                <img src="/matchgo_logo.svg" alt="MatchGo" className="h-8 w-auto object-contain" />
              </Link>
              <p className="text-xs text-slate-500 leading-relaxed">
                Plataforma de gestión integral para clubes de pádel y tenis. Grilla en vivo, cuenta del turno, mostrador y finanzas.
              </p>
            </div>

            <div>
              <p className="text-xs font-bold uppercase text-slate-800 tracking-wider mb-3">Jugadores</p>
              <ul className="space-y-2 text-xs text-slate-500">
                <li><Link to="/player" className="hover:text-[#00A859]">Buscar Canchas</Link></li>
                <li><Link to="/player" className="hover:text-[#00A859]">Mis Reservas</Link></li>
                <li><Link to="/player" className="hover:text-[#00A859]">Dividir Cuenta</Link></li>
              </ul>
            </div>

            <div>
              <p className="text-xs font-bold uppercase text-slate-800 tracking-wider mb-3">Clubes</p>
              <ul className="space-y-2 text-xs text-slate-500">
                <li><Link to="/login" className="hover:text-[#00A859]">Software para Clubes</Link></li>
                <li><a href="#funcionalidades" className="hover:text-[#00A859]">Grilla & Turnos Fijos</a></li>
                <li><a href="#experiencia" className="hover:text-[#00A859]">Experiencia en Vivo</a></li>
              </ul>
            </div>

            <div>
              <p className="text-xs font-bold uppercase text-slate-800 tracking-wider mb-3">Contacto</p>
              <p className="text-xs text-slate-500 mb-2">Soporte para clubes en Salta, Argentina y Latinoamérica.</p>
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#00A859]">
                <span className="w-2 h-2 rounded-full bg-[#00A859] animate-pulse" /> Servidores 100% Operativos
              </span>
            </div>
          </div>

          <div className="pt-8 border-t border-[#E2DDD1] text-center text-xs text-slate-400">
            © {new Date().getFullYear()} MatchGo Padel SaaS. Todos los derechos reservados.
          </div>
        </div>
      </footer>
    </div>
  );
}
