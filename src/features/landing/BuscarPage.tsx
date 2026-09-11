import { useState, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import {
  MapPin,
  Calendar,
  Clock,
  ArrowRight,
  ShieldCheck,
  Info,
  Loader2,
  CheckCircle2,
  Trophy,
  ChevronLeft,
  Building2,
  Sparkles,
} from 'lucide-react';
import { useClubsPublicos } from './hooks/useClubsPublicos';
import { supabase } from '@/lib/supabase';
import { DEPORTES_CATALOGO, obtenerInfoDeporte } from '@/lib/deportes';
import { PlayerNavDropdown } from './components/PlayerNavDropdown';
import './landing.css';

// Fotos atractivas reales de canchas
const FOTOS_DEPORTE: Record<string, string[]> = {
  padel: [
    '/assets/padel-1.jpg',
    '/assets/act-padel-a.jpg',
    '/assets/padel-2.jpg',
    'https://images.pexels.com/photos/32474981/pexels-photo-32474981/free-photo-of-indoor-padel-court-with-blue-surface.jpeg?auto=compress&cs=tinysrgb&w=800&h=450&fit=crop',
  ],
  tenis: [
    '/assets/tennis-1.jpg',
    'https://images.pexels.com/photos/209977/pexels-photo-209977.jpeg?auto=compress&cs=tinysrgb&w=800&h=450&fit=crop',
  ],
  pickleball: [
    'https://images.pexels.com/photos/32897040/pexels-photo-32897040/free-photo-of-vibrant-indoor-padel-court-with-racket-and-balls.jpeg?auto=compress&cs=tinysrgb&w=800&h=450&fit=crop',
  ],
  futbol: [
    'https://images.pexels.com/photos/47730/the-ball-stadion-football-the-pitch-47730.jpeg?auto=compress&cs=tinysrgb&w=800&h=450&fit=crop',
  ],
  futbol_5: [
    'https://images.pexels.com/photos/114296/pexels-photo-114296.jpeg?auto=compress&cs=tinysrgb&w=800&h=450&fit=crop',
  ],
};

interface SlotReal {
  cancha_id: number;
  cancha_nombre: string;
  hora_inicio: string;
  hora_fin: string;
  disponible: boolean;
}

export function BuscarPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Fechas dinámicas
  const todayDate = useMemo(() => new Date(), []);
  const tomorrowDate = useMemo(() => new Date(Date.now() + 86400000), []);
  const formatDateLabel = (d: Date) => d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
  const todayLabel = `Hoy ${formatDateLabel(todayDate)}`;
  const tomorrowLabel = `Mañana ${formatDateLabel(tomorrowDate)}`;

  // Parámetros de búsqueda iniciales desde URL o defaults
  const paramCiudad = searchParams.get('ciudad') || 'Salta';
  const paramDeporte = searchParams.get('deporte') || 'padel';
  const paramFecha = searchParams.get('fecha') || tomorrowLabel;
  const paramHora = searchParams.get('hora') || '14:30hs';

  const [selectedCity, setSelectedCity] = useState(paramCiudad);
  const [selectedSport, setSelectedSport] = useState(paramDeporte);
  const [selectedDate, setSelectedDate] = useState(paramFecha);
  const [selectedTime, setSelectedTime] = useState(paramHora);

  const [selectedSlotByClub, setSelectedSlotByClub] = useState<Record<string, { hora: string; cancha_id?: number }>>({});

  const targetDateISO = useMemo(() => {
    if (selectedDate.startsWith('Mañana')) {
      return tomorrowDate.toISOString().slice(0, 10);
    }
    if (selectedDate.startsWith('Hoy')) {
      return todayDate.toISOString().slice(0, 10);
    }
    // Si viene en formato ISO directo (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
      return selectedDate;
    }
    return tomorrowDate.toISOString().slice(0, 10);
  }, [selectedDate, todayDate, tomorrowDate]);

  const sportInfo = obtenerInfoDeporte(selectedSport);

  // Sincronizar cambios de filtros con la URL
  const updateFilters = (city: string, sport: string, date: string, time: string) => {
    setSelectedCity(city);
    setSelectedSport(sport);
    setSelectedDate(date);
    setSelectedTime(time);
    setSearchParams({
      ciudad: city,
      deporte: sport,
      fecha: date,
      hora: time,
    });
  };

  const { data: clubs = [], isLoading: isLoadingClubs } = useClubsPublicos();

  // Filtrar clubes por ciudad si aplica (o mostrar todos si no hay match directo)
  const filteredClubs = useMemo(() => {
    if (!clubs || clubs.length === 0) return [];
    
    const cityMatch = clubs.filter((c) =>
      c.ciudad && c.ciudad.toLowerCase().includes(selectedCity.toLowerCase())
    );

    if (cityMatch.length > 0) return cityMatch;
    return clubs;
  }, [clubs, selectedCity]);

  // Consultar disponibilidad real de cada club desde la base de datos de Supabase
  const availabilityQueries = useQueries({
    queries: filteredClubs.map((club) => ({
      queryKey: ['disponibilidad-real-club', club.slug, targetDateISO],
      queryFn: async (): Promise<{ slug: string; slots: SlotReal[] }> => {
        try {
          const { data, error } = await supabase.rpc('fn_disponibilidad_publica', {
            p_club_slug: club.slug,
            p_fecha: targetDateISO,
          });
          if (error) {
            console.warn(`Error al obtener turnos para ${club.slug}:`, error);
            return { slug: club.slug, slots: [] };
          }
          return { slug: club.slug, slots: (data ?? []) as SlotReal[] };
        } catch (e) {
          console.error(e);
          return { slug: club.slug, slots: [] };
        }
      },
      staleTime: 1000 * 60 * 2,
    })),
  });

  const isAnyLoading = isLoadingClubs || availabilityQueries.some((q) => q.isLoading);

  // Mapear disponibilidad por slug de club
  const availabilityBySlug = useMemo(() => {
    const map = new Map<string, SlotReal[]>();
    for (const res of availabilityQueries) {
      if (res.data) {
        map.set(res.data.slug, res.data.slots);
      }
    }
    return map;
  }, [availabilityQueries]);

  const handleSelectSlot = (slug: string, hora: string, cancha_id?: number) => {
    setSelectedSlotByClub((prev) => ({ ...prev, [slug]: { hora, cancha_id } }));
  };

  const handleBooking = (slug: string, hora: string) => {
    navigate(`/club/${slug}?fecha=${targetDateISO}&hora=${hora}&deporte=${selectedSport}`);
  };

  return (
    <div className="mg-landing min-h-screen bg-[#F4F2EB] flex flex-col">
      {/* ===== NAV BAR (Responsive con acceso a Clubes y Jugador) ===== */}
      <header className="nav-bar sticky top-0 z-50 bg-[#F4F2EB]/95 backdrop-blur-md border-b border-[#E2DDD1]">
        <div className="container">
          <div className="nav-content flex items-center justify-between h-16 sm:h-20">
            {/* Logo oficial y botón volver */}
            <div className="flex items-center gap-2 sm:gap-4">
              <Link
                to="/"
                className="flex items-center gap-1.5 text-xs sm:text-sm font-bold text-slate-600 hover:text-emerald-700 transition-colors py-1.5 px-2.5 rounded-full hover:bg-slate-200/60"
              >
                <ChevronLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Inicio</span>
              </Link>

              <Link to="/" className="flex items-center">
                <img
                  src="/matchgo_logo.svg"
                  alt="MatchGo"
                  className="h-8 sm:h-10 w-auto object-contain transition-transform hover:scale-105"
                />
              </Link>
            </div>

            {/* Acciones a la derecha: Botón verde para clubes + Perfil de Jugador */}
            <div className="flex items-center gap-2 sm:gap-4">
              <Link
                to="/login"
                className="bg-[#00B050] hover:bg-[#009243] text-white font-bold text-xs sm:text-sm px-3 sm:px-5 py-2 sm:py-2.5 rounded-full shadow-sm hover:shadow-md transition-all flex items-center gap-1.5 whitespace-nowrap"
              >
                <Building2 className="w-3.5 h-3.5 hidden xs:inline" />
                <span className="hidden sm:inline">Software para clubes</span>
                <span className="sm:hidden">Clubes</span>
              </Link>

              <PlayerNavDropdown />
            </div>
          </div>
        </div>
      </header>

      {/* ===== HERO COMPACTO CON FILTROS DE BÚSQUEDA ===== */}
      <section className="bg-[#0B132B] text-white py-8 sm:py-12 relative overflow-hidden">
        <div className="container relative z-10">
          <div className="max-w-4xl mx-auto text-center mb-6 sm:mb-8">
            <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-[#00FF87] text-xs font-bold uppercase tracking-wider mb-3">
              <Sparkles className="h-3.5 w-3.5" />
              Portal de Búsqueda de Canchas
            </div>
            <h1 className="text-2xl sm:text-4xl font-black tracking-tight text-white">
              Canchas de {sportInfo.label} en {selectedCity}
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 mt-1">
              Turnos disponibles en vivo con confirmación al instante.
            </p>
          </div>

          {/* Floating Search Bar adaptativa */}
          <div className="bg-white rounded-2xl sm:rounded-full p-2.5 sm:p-2 shadow-2xl border border-slate-200/80 max-w-4xl mx-auto flex flex-col md:flex-row items-stretch md:items-center gap-2">
            {/* 1. Buscar Ciudad */}
            <div className="flex items-center gap-2.5 px-3 py-2 flex-1 hover:bg-slate-50 rounded-xl transition-colors">
              <MapPin className="h-4 w-4 text-emerald-600 flex-shrink-0" />
              <div className="w-full">
                <p className="text-[10px] uppercase font-bold text-slate-400 leading-none mb-0.5">Ciudad</p>
                <select
                  value={selectedCity}
                  onChange={(e) => updateFilters(e.target.value, selectedSport, selectedDate, selectedTime)}
                  className="bg-transparent font-bold text-xs sm:text-sm text-slate-800 outline-none cursor-pointer w-full"
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

            <div className="hidden md:block w-px h-8 bg-slate-200" />

            {/* 2. Elige Deporte */}
            <div className="flex items-center gap-2.5 px-3 py-2 flex-1 hover:bg-slate-50 rounded-xl transition-colors">
              <Trophy className="h-4 w-4 text-emerald-600 flex-shrink-0" />
              <div className="w-full">
                <p className="text-[10px] uppercase font-bold text-slate-400 leading-none mb-0.5">Deporte</p>
                <select
                  value={selectedSport}
                  onChange={(e) => updateFilters(selectedCity, e.target.value, selectedDate, selectedTime)}
                  className="bg-transparent font-bold text-xs sm:text-sm text-slate-800 outline-none cursor-pointer w-full"
                >
                  {DEPORTES_CATALOGO.map((dep) => (
                    <option key={dep.id} value={dep.id}>
                      {dep.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="hidden md:block w-px h-8 bg-slate-200" />

            {/* 3. Fecha */}
            <div className="flex items-center gap-2.5 px-3 py-2 flex-1 hover:bg-slate-50 rounded-xl transition-colors">
              <Calendar className="h-4 w-4 text-emerald-600 flex-shrink-0" />
              <div className="w-full">
                <p className="text-[10px] uppercase font-bold text-slate-400 leading-none mb-0.5">Fecha</p>
                <select
                  value={selectedDate}
                  onChange={(e) => updateFilters(selectedCity, selectedSport, e.target.value, selectedTime)}
                  className="bg-transparent font-bold text-xs sm:text-sm text-slate-800 outline-none cursor-pointer w-full"
                >
                  <option value={todayLabel}>{todayLabel}</option>
                  <option value={tomorrowLabel}>{tomorrowLabel}</option>
                  <option value="Viernes 12/09">Viernes 12/09</option>
                  <option value="Sábado 13/09">Sábado 13/09</option>
                  <option value="Domingo 14/09">Domingo 14/09</option>
                </select>
              </div>
            </div>

            <div className="hidden md:block w-px h-8 bg-slate-200" />

            {/* 4. Horario */}
            <div className="flex items-center gap-2.5 px-3 py-2 flex-1 hover:bg-slate-50 rounded-xl transition-colors">
              <Clock className="h-4 w-4 text-emerald-600 flex-shrink-0" />
              <div className="w-full">
                <p className="text-[10px] uppercase font-bold text-slate-400 leading-none mb-0.5">Horario</p>
                <select
                  value={selectedTime}
                  onChange={(e) => updateFilters(selectedCity, selectedSport, selectedDate, e.target.value)}
                  className="bg-transparent font-bold text-xs sm:text-sm text-slate-800 outline-none cursor-pointer w-full"
                >
                  <option value="10:00hs">10:00hs</option>
                  <option value="11:30hs">11:30hs</option>
                  <option value="14:30hs">14:30hs</option>
                  <option value="16:00hs">16:00hs</option>
                  <option value="18:00hs">18:00hs</option>
                  <option value="19:30hs">19:30hs</option>
                  <option value="21:00hs">21:00hs</option>
                  <option value="22:30hs">22:30hs</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== RESULTADOS EN TIEMPO REAL ===== */}
      <main className="flex-1 py-10">
        <div className="container">
          {/* Header de resultados */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 pb-4 border-b border-slate-300 gap-4">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold uppercase tracking-wider mb-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse" />
                Disponibilidad en Vivo
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-slate-900">
                Clubes con canchas de {sportInfo.label} en {selectedCity}
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 mt-1 flex items-center gap-2">
                <span>{selectedDate}</span>
                <span>•</span>
                <span>Horario sugerido: <strong>{selectedTime}</strong></span>
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-bold px-3 py-1.5 rounded-full bg-white border border-slate-200 text-slate-700 shadow-sm">
                {filteredClubs.length} complejo(s) encontrado(s)
              </span>
            </div>
          </div>

          {/* Estado de Carga */}
          {isAnyLoading && (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500 gap-3">
              <Loader2 className="w-9 h-9 animate-spin text-emerald-600" />
              <p className="text-sm font-semibold">Consultando disponibilidad de canchas en vivo...</p>
            </div>
          )}

          {/* Sin Resultados */}
          {!isAnyLoading && filteredClubs.length === 0 && (
            <div className="bg-white rounded-3xl p-10 text-center border border-slate-200 shadow-sm max-w-xl mx-auto">
              <div className="w-16 h-16 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4">
                <Info className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">
                No encontramos canchas registradas en {selectedCity}
              </h3>
              <p className="text-sm text-slate-500 mb-6">
                Probá seleccionando <strong>Salta</strong> o cambiá el deporte para ver los clubes con disponibilidad en tiempo real.
              </p>
              <button
                type="button"
                onClick={() => updateFilters('Salta', 'padel', selectedDate, selectedTime)}
                className="px-6 py-2.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow transition-all"
              >
                Ver clubes en Salta
              </button>
            </div>
          )}

          {/* Grid de Clubes y Canchas */}
          {!isAnyLoading && filteredClubs.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {filteredClubs.map((club, idx) => {
                const fotos = FOTOS_DEPORTE[selectedSport] || FOTOS_DEPORTE.padel || [];
                const defaultFoto = fotos[0] || '/assets/padel-1.jpg';
                const displayFoto = club.portada_url || fotos[idx % (fotos.length || 1)] || defaultFoto;
                
                // Turnos reales desde Supabase
                const allSlots = availabilityBySlug.get(club.slug) || [];
                const freeSlots = allSlots.filter((s) => s.disponible);

                // Formatear horas a 5 caracteres (HH:MM)
                const formattedSlots = freeSlots.map((s) => ({
                  ...s,
                  horaFormatted: s.hora_inicio.slice(0, 5),
                }));

                // Deduplicar horas para mostrar botones limpios
                const uniqueHours = Array.from(
                  new Map(formattedSlots.map((s) => [s.horaFormatted, s])).values()
                );

                // Horario seleccionado para este club
                const currentSelected =
                  selectedSlotByClub[club.slug]?.hora || 
                  uniqueHours.find((s) => s.horaFormatted === selectedTime.replace('hs', ''))?.horaFormatted ||
                  uniqueHours[0]?.horaFormatted ||
                  '19:30';

                return (
                  <div
                    key={club.id}
                    className="bg-white rounded-3xl border border-slate-200/90 shadow-lg hover:shadow-2xl transition-all duration-300 overflow-hidden flex flex-col group"
                  >
                    {/* Foto de la Cancha / Club con Badges */}
                    <div className="relative h-52 sm:h-60 w-full overflow-hidden bg-slate-900">
                      <img
                        src={displayFoto}
                        alt={club.nombre}
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />

                      {/* Badge de Deporte Superior */}
                      <div className="absolute top-4 left-4 flex items-center gap-2">
                        <span className="px-3 py-1 rounded-full bg-slate-900/90 backdrop-blur-md text-white text-xs font-bold flex items-center gap-1.5 border border-white/20 shadow">
                          <span>{sportInfo.label}</span>
                        </span>
                        {uniqueHours.length > 0 ? (
                          <span className="px-2.5 py-1 rounded-full bg-[#00A859] text-white text-xs font-extrabold shadow flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            {uniqueHours.length} turnos libres
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-full bg-amber-500 text-white text-xs font-extrabold shadow">
                            Consultar club
                          </span>
                        )}
                      </div>

                      {/* Link a perfil del club en la esquina superior derecha */}
                      <Link
                        to={`/club/${club.slug}`}
                        className="absolute top-4 right-4 px-3 py-1 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-md text-white text-xs font-bold border border-white/30 shadow transition-all"
                      >
                        Ver Club
                      </Link>

                      {/* Información sobre la foto */}
                      <div className="absolute bottom-4 left-4 right-4 text-white">
                        <h3 className="text-xl sm:text-2xl font-black leading-tight drop-shadow">
                          {club.nombre}
                        </h3>
                        <p className="text-xs text-slate-200 flex items-center gap-1 mt-1 drop-shadow">
                          <MapPin className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                          <span className="truncate">{club.ciudad || 'Salta'}, Argentina</span>
                        </p>
                      </div>
                    </div>

                    {/* Cuerpo de la Tarjeta con Horarios y Precios */}
                    <div className="p-5 sm:p-6 flex-1 flex flex-col justify-between space-y-5">
                      {/* Selector de Horarios Disponibles Reales */}
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                            Horarios libres ({selectedDate}):
                          </p>
                          <span className="text-emerald-700 font-extrabold text-xs flex items-center gap-1">
                            <ShieldCheck className="w-3.5 h-3.5" /> Reserva instantánea
                          </span>
                        </div>

                        {uniqueHours.length > 0 ? (
                          <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                            {uniqueHours.slice(0, 10).map((s) => {
                              const isSelected = currentSelected === s.horaFormatted;
                              return (
                                <button
                                  key={`${s.cancha_id}-${s.horaFormatted}`}
                                  type="button"
                                  onClick={() => handleSelectSlot(club.slug, s.horaFormatted, s.cancha_id)}
                                  className={`py-2 px-1 rounded-xl text-center font-bold text-xs transition-all cursor-pointer border ${
                                    isSelected
                                      ? 'bg-[#00A859] text-white border-[#00A859] shadow-md shadow-emerald-500/25 ring-2 ring-emerald-400/30'
                                      : 'bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-200'
                                  }`}
                                >
                                  <div>{s.horaFormatted}</div>
                                  <div className="text-[10px] font-normal opacity-85 truncate">
                                    {s.cancha_nombre || 'Cancha'}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="p-4 bg-slate-50 rounded-2xl text-center text-xs text-slate-500 border border-slate-100">
                            Todos los turnos de esta fecha ya fueron reservados.
                          </div>
                        )}
                      </div>

                      {/* Botón de Reserva y Precio Total */}
                      <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-4">
                        <div>
                          <p className="text-[10px] uppercase font-bold text-slate-400">Modalidad de pago</p>
                          <p className="text-sm sm:text-base font-black text-slate-900">
                            {club.sena_obligatoria && club.sena_valor
                              ? `Seña $${club.sena_valor.toLocaleString('es-AR')}`
                              : 'Pago en recepción'}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleBooking(club.slug, currentSelected)}
                          className="px-5 sm:px-6 py-2.5 rounded-full bg-[#0B1F4D] hover:bg-[#00A859] text-white font-bold text-xs sm:text-sm flex items-center gap-2 shadow-md hover:shadow-lg transition-all duration-200 cursor-pointer group/btn"
                        >
                          <span>Reservar {currentSelected}hs</span>
                          <ArrowRight className="w-4 h-4 transition-transform group-hover/btn:translate-x-1" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* ===== FOOTER LIGERO ===== */}
      <footer className="footer-light mt-auto">
        <div className="container text-center">
          <p className="text-xs text-slate-500">
            © {new Date().getFullYear()} MatchGo. Portal de reservas y software de gestión deportiva.
          </p>
        </div>
      </footer>
    </div>
  );
}
