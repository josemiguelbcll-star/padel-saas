import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import {
  MapPin,
  Calendar,
  Clock,
  ArrowRight,
  ShieldCheck,
  Info,
  Loader2,
  CheckCircle2
} from 'lucide-react';
import { useClubsPublicos } from '../hooks/useClubsPublicos';
import { supabase } from '@/lib/supabase';
import { obtenerInfoDeporte } from '@/lib/deportes';

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

interface RealCourtSearchResultsProps {
  selectedCity: string;
  selectedSport: string;
  selectedDate: string;
  selectedTime: string;
  targetDateISO: string;
}

export function RealCourtSearchResults({
  selectedCity,
  selectedSport,
  selectedDate,
  selectedTime,
  targetDateISO,
}: RealCourtSearchResultsProps) {
  const navigate = useNavigate();
  const { data: clubs = [], isLoading: isLoadingClubs } = useClubsPublicos();
  const [selectedSlotByClub, setSelectedSlotByClub] = useState<Record<string, { hora: string; cancha_id?: number }>>({});

  const sportInfo = obtenerInfoDeporte(selectedSport);

  // Filtrar clubes por ciudad si aplica (o mostrar todos los clubes si no hay filtro de ciudad o coincide)
  const filteredClubs = useMemo(() => {
    if (!clubs || clubs.length === 0) return [];
    
    // Si la ciudad coincide exactamente con algún club
    const cityMatch = clubs.filter((c) =>
      c.ciudad && c.ciudad.toLowerCase().includes(selectedCity.toLowerCase())
    );

    if (cityMatch.length > 0) return cityMatch;
    
    // Si no hay ciudad especificada o no hay coincidencia exacta, devolver todos los clubes registrados
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
      staleTime: 1000 * 60 * 2, // 2 minutos
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
    <div id="resultados-busqueda" className="w-full py-12 bg-[#FBFBFA] border-t border-slate-200/70">
      <div className="container">
        {/* Encabezado de los Resultados */}
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 pb-4 border-b border-slate-200 gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold uppercase tracking-wider mb-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Disponibilidad en Tiempo Real
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              Canchas de {sportInfo.label} en {selectedCity || 'tu zona'}
            </h2>
            <p className="text-sm text-slate-600 mt-1 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-400" />
              <span>{selectedDate}</span>
              <span>•</span>
              <Clock className="w-4 h-4 text-slate-400" />
              <span>Horario preferido: <strong>{selectedTime}</strong></span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500">
              {filteredClubs.length} complejo(s) registrados
            </span>
          </div>
        </div>

        {/* Loading Spinner */}
        {isAnyLoading && (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
            <p className="text-sm font-semibold">Consultando disponibilidad en vivo en la base de datos...</p>
          </div>
        )}

        {/* Lista de Canchas / Clubes Disponibles */}
        {!isAnyLoading && filteredClubs.length === 0 && (
          <div className="bg-white rounded-3xl p-10 text-center border border-slate-200 shadow-sm">
            <div className="w-16 h-16 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4">
              <Info className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">
              No encontramos canchas registradas en {selectedCity}
            </h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto mb-6">
              Probá seleccionando <strong>Salta</strong> o explorá todos los complejos disponibles para ver los turnos en vivo.
            </p>
          </div>
        )}

        {!isAnyLoading && filteredClubs.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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

              // Deduplicar horas para mostrar opciones claras
              const uniqueHours = Array.from(
                new Map(formattedSlots.map((s) => [s.horaFormatted, s])).values()
              );

              // Horario seleccionado para este club
              const currentSelected = selectedSlotByClub[club.slug]?.hora || 
                uniqueHours.find((s) => s.horaFormatted === selectedTime.replace('hs', ''))?.horaFormatted ||
                uniqueHours[0]?.horaFormatted ||
                '19:30';

              return (
                <div
                  key={club.id}
                  className="bg-white rounded-3xl border border-slate-200/80 shadow-md hover:shadow-xl transition-all duration-300 overflow-hidden flex flex-col group"
                >
                  {/* Foto de la Cancha / Club con Badges */}
                  <div className="relative h-48 sm:h-56 w-full overflow-hidden bg-slate-100">
                    <img
                      src={displayFoto}
                      alt={club.nombre}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />

                    {/* Badge de Deporte Superior */}
                    <div className="absolute top-4 left-4 flex items-center gap-2">
                      <span className="px-3 py-1 rounded-full bg-slate-900/85 backdrop-blur-md text-white text-xs font-bold flex items-center gap-1.5 border border-white/20 shadow">
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

                    {/* Información sobre la foto */}
                    <div className="absolute bottom-3 left-4 right-4 text-white">
                      <h3 className="text-xl font-black leading-tight drop-shadow">
                        {club.nombre}
                      </h3>
                      <p className="text-xs text-slate-200 flex items-center gap-1 mt-1 drop-shadow">
                        <MapPin className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                        <span className="truncate">{club.ciudad || 'Salta'}, Argentina</span>
                      </p>
                    </div>
                  </div>

                  {/* Cuerpo de la Tarjeta con Horarios y Precios */}
                  <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                    {/* Selector de Horarios Disponibles Reales */}
                    <div>
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5 flex items-center justify-between">
                        <span>Horarios reales ({selectedDate}):</span>
                        <span className="text-emerald-600 font-extrabold text-[11px] flex items-center gap-1">
                          <ShieldCheck className="w-3.5 h-3.5" /> Reserva garantizada
                        </span>
                      </p>

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
                                <div className="text-[10px] font-normal opacity-90 truncate">
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
                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-4">
                      <div>
                        <p className="text-[10px] uppercase font-bold text-slate-400">Reserva online</p>
                        <p className="text-base sm:text-lg font-black text-slate-900">
                          {club.sena_obligatoria && club.sena_valor
                            ? `Seña $${club.sena_valor.toLocaleString('es-AR')}`
                            : 'Pago en recepción'}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleBooking(club.slug, currentSelected)}
                        className="px-5 py-2.5 rounded-full bg-[#0B1F4D] hover:bg-[#00A859] text-white font-bold text-xs sm:text-sm flex items-center gap-2 shadow-md transition-all duration-200 cursor-pointer group/btn"
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
    </div>
  );
}
