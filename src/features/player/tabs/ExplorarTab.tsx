import { useState, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import {
  MapPin,
  Calendar,
  Clock,
  Trophy,
  ArrowRight,
  Info,
  SlidersHorizontal,
  Sparkles,
  ChevronDown,
  Check,
} from 'lucide-react';
import { useClubsPublicos } from '@/features/landing/hooks/useClubsPublicos';
import { supabase } from '@/lib/supabase';
import { getLogoClubUrl } from '@/lib/clubBrand';
import { DEPORTES_CATALOGO, obtenerInfoDeporte } from '@/lib/deportes';
import { diferenciaMinutos } from '@/features/reservas/utils/horaUtils';

// Precios de referencia según club para visuales atractivas
const PRECIOS_ESTIMADOS: Record<string, string> = {
  'domo-padel': '$18.000',
  'signo-d-padel': '$16.000',
  'tucan-padel-center': '$20.000',
  'verbum-camp': '$15.000',
  'sporting-futbol-club': '$35.000',
  'il-calcio': '$40.000',
  'la-loma-padel': '$44.000',
  'la-sirio-padel': '$52.000',
  'club-raqueta': '$44.000',
  'green-futbol-club': '$18.000',
};

// ── Helpers de fecha y hora ───────────────────────────────────────────────────

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(baseIso: string, days: number): string {
  const d = new Date(baseIso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function isPastDateTime(fecha: string, hora: string): boolean {
  const dt = new Date(`${fecha}T${hora}`);
  return dt.getTime() < Date.now();
}

interface SlotPublico {
  cancha_id: number;
  cancha_nombre: string;
  hora_inicio: string;
  hora_fin: string;
  disponible: boolean;
}

export interface ExplorarTabProps {
  onSelectClub: (slug: string, fecha?: string, hora?: string) => void;
}

export function ExplorarTab({ onSelectClub }: ExplorarTabProps) {
  const hoyISO = useMemo(() => todayISO(), []);
  const mananaISO = useMemo(() => addDaysISO(hoyISO, 1), [hoyISO]);

  // Generar opciones de fecha para el selector (Próximos 7 días)
  const opcionesFechas = useMemo(() => {
    const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    
    return Array.from({ length: 7 }, (_, i) => {
      const iso = addDaysISO(hoyISO, i);
      const [y, m, d] = iso.split('-').map(Number);
      const dt = new Date((y ?? 2000), (m ?? 1) - 1, d ?? 1);
      const diaNom = DIAS_SEMANA[dt.getDay()];
      const diaNum = String(d).padStart(2, '0');
      const mesNum = String(m).padStart(2, '0');

      let label = `${diaNom} ${diaNum}/${mesNum}`;
      if (i === 0) label = `Hoy ${diaNum}/${mesNum}`;
      if (i === 1) label = `Mañana ${diaNum}/${mesNum}`;

      return {
        iso,
        label,
      };
    });
  }, [hoyISO]);

  // ── Estados de filtros de búsqueda ──
  const [selectedCiudad, setSelectedCiudad] = useState<string>('Salta');
  const [selectedDeporte, setSelectedDeporte] = useState<string>('padel');
  const [selectedFecha, setSelectedFecha] = useState<string>(mananaISO);
  const [selectedHora, setSelectedHora] = useState<string>('16:00');
  
  // Filtros secundarios
  const [selectedDuracion, setSelectedDuracion] = useState<string>('todas');
  const [selectedCerramiento, setSelectedCerramiento] = useState<string>('todas');
  const [ordenarPor, setOrdenarPor] = useState<'relevancia' | 'turnos' | 'nombre'>('relevancia');

  // Cargar clubes públicos
  const { data: clubs = [], isLoading: isLoadingClubs } = useClubsPublicos();

  // Filtrar clubes por ciudad (considerando default 'Salta' si no tiene ciudad seteada)
  const clubsFiltrados = useMemo(() => {
    if (!clubs || clubs.length === 0) return [];
    return clubs.filter((c) => {
      // Excluir registros vacíos o sin canchas conocidas
      if (c.slug === 'juancito-macana' || c.slug === 'domo-padel') return false;
      if (!selectedCiudad || selectedCiudad === 'todas') return true;
      const ciudadClub = c.ciudad || 'Salta';
      return ciudadClub.toLowerCase().includes(selectedCiudad.toLowerCase());
    });
  }, [clubs, selectedCiudad]);

  // Obtener ciudades disponibles
  const ciudadesDisponibles = useMemo(() => {
    const set = new Set<string>();
    set.add('Salta');
    for (const c of clubs) {
      if (c.ciudad) set.add(c.ciudad);
    }
    return Array.from(set);
  }, [clubs]);

  // ── Consultar disponibilidad real de cada club para la fecha ──
  const availabilityQueries = useQueries({
    queries: clubsFiltrados.map((club) => ({
      queryKey: ['disponibilidad-club-player', club.slug, selectedFecha],
      queryFn: async (): Promise<{ slug: string; slots: SlotPublico[] }> => {
        try {
          const { data, error } = await supabase.rpc('fn_disponibilidad_publica', {
            p_club_slug: club.slug,
            p_fecha: selectedFecha,
          });
          if (error) {
            console.warn(`Error al consultar turnos para ${club.slug}:`, error);
            return { slug: club.slug, slots: [] };
          }
          return { slug: club.slug, slots: (data ?? []) as SlotPublico[] };
        } catch (e) {
          console.error(e);
          return { slug: club.slug, slots: [] };
        }
      },
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 15,
      refetchOnWindowFocus: false,
    })),
  });

  const isLoadingDisponibilidad = availabilityQueries.some((q) => q.isLoading);

  // Mapear slots disponibles filtrados por club
  const disponibilidadPorClub = useMemo(() => {
    const map = new Map<
      string,
      {
        totalLibres: (SlotPublico & { duracion_min: number })[];
        slotsCoincidentes: (SlotPublico & { duracion_min: number })[];
        pillsVisibles: string[];
      }
    >();

    for (let i = 0; i < clubsFiltrados.length; i++) {
      const club = clubsFiltrados[i];
      if (!club) continue;
      const queryResult = availabilityQueries[i];
      const slots = queryResult?.data?.slots ?? [];

      // Filtrar solo los turnos que están verdaderamente disponibles (no reservados ni con clases) y no pasados
      const libres = slots
        .filter((s) => s.disponible && !isPastDateTime(selectedFecha, s.hora_inicio))
        .map((s) => ({
          ...s,
          duracion_min: diferenciaMinutos(s.hora_inicio, s.hora_fin),
        }));

      // Filtrar por duración si el usuario eligió una duración específica
      const libresConDuracion = libres.filter((s) => {
        if (selectedDuracion !== 'todas' && s.duracion_min !== Number(selectedDuracion)) {
          return false;
        }
        return true;
      });

      // Coincidentes exactos o cercanos con la hora seleccionada
      let coincidentes = libresConDuracion;
      if (selectedHora !== 'todas') {
        const [targetH, targetM] = selectedHora.split(':').map(Number);
        const targetMinutos = (targetH ?? 0) * 60 + (targetM ?? 0);

        coincidentes = libresConDuracion.filter((s) => {
          const [sh, sm] = s.hora_inicio.slice(0, 5).split(':').map(Number);
          const slotMinutos = (sh ?? 0) * 60 + (sm ?? 0);
          // Ventana de hasta 60 minutos de cercanía al horario solicitado
          return Math.abs(slotMinutos - targetMinutos) <= 60;
        });
      }

      // Generar píldoras de horarios válidos para este club
      const timeSet = new Set<string>();
      if (selectedHora !== 'todas') {
        // Primero buscar si tiene la hora exacta libre
        const exactMatch = libresConDuracion.find((s) => s.hora_inicio.slice(0, 5) === selectedHora);
        if (exactMatch) {
          timeSet.add(exactMatch.hora_inicio.slice(0, 5));
        }
        // Ordenar por cercanía al horario solicitado
        const ordenadosPorCercania = [...coincidentes].sort((a, b) => {
          const [targetH, targetM] = selectedHora.split(':').map(Number);
          const targetMinutos = (targetH ?? 0) * 60 + (targetM ?? 0);
          const [ah, am] = a.hora_inicio.slice(0, 5).split(':').map(Number);
          const [bh, bm] = b.hora_inicio.slice(0, 5).split(':').map(Number);
          const diffA = Math.abs((ah ?? 0) * 60 + (am ?? 0) - targetMinutos);
          const diffB = Math.abs((bh ?? 0) * 60 + (bm ?? 0) - targetMinutos);
          return diffA - diffB;
        });

        for (const s of ordenadosPorCercania) {
          if (timeSet.size >= 4) break;
          timeSet.add(s.hora_inicio.slice(0, 5));
        }
      } else {
        // Si eligió 'Cualquier hora', mostrar hasta 4 turnos disponibles a lo largo del día
        for (const s of libresConDuracion) {
          if (timeSet.size >= 4) break;
          timeSet.add(s.hora_inicio.slice(0, 5));
        }
      }

      map.set(club.slug, {
        totalLibres: libres,
        slotsCoincidentes: coincidentes,
        pillsVisibles: Array.from(timeSet).sort(),
      });
    }

    return map;
  }, [clubsFiltrados, availabilityQueries, selectedFecha, selectedHora, selectedDuracion]);

  // ── Filtrar estrictamente solo los clubes que CUMPLEN con los filtros y tienen turnos disponibles ──
  const clubesVisibles = useMemo(() => {
    const list = clubsFiltrados.filter((c) => {
      const dataDisp = disponibilidadPorClub.get(c.slug);
      const pills = dataDisp?.pillsVisibles ?? [];
      // SI NO TIENE TURNOS DISPONIBLES COINCIDENTES, SE EXCLUYE COMPLETAMENTE
      return pills.length > 0;
    });

    return list.sort((a, b) => {
      const dataA = disponibilidadPorClub.get(a.slug);
      const dataB = disponibilidadPorClub.get(b.slug);

      if (ordenarPor === 'turnos') {
        return (dataB?.totalLibres.length ?? 0) - (dataA?.totalLibres.length ?? 0);
      }
      if (ordenarPor === 'nombre') {
        return a.nombre.localeCompare(b.nombre);
      }
      return (dataB?.pillsVisibles.length ?? 0) - (dataA?.pillsVisibles.length ?? 0);
    });
  }, [clubsFiltrados, disponibilidadPorClub, ordenarPor]);

  return (
    <div style={{ background: '#F4F2EB', minHeight: '100vh', paddingBottom: '90px' }}>
      
      {/* ── HEADER SUPERIOR CON BUSCADOR FLOTANTE (ESTILO MARKETPLACE) ── */}
      <div style={{
        background: '#FFFFFF',
        borderBottom: '1px solid #E2DDD1',
        padding: '16px 16px 12px',
        position: 'sticky',
        top: 0,
        zIndex: 30,
        boxShadow: '0 2px 10px rgba(0,0,0,0.03)',
      }}>
        {/* Barra de Búsqueda Principal estilo píldora/formulario */}
        <div style={{
          background: '#FFFFFF',
          borderRadius: '16px',
          border: '1.5px solid #E2E8F0',
          padding: '4px',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.04)',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '4px',
          }}>
            
            {/* 1. Ciudad */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              borderRadius: '12px',
              background: '#F8FAFC',
            }}>
              <MapPin size={16} color="#00B050" style={{ flexShrink: 0 }} />
              <div style={{ width: '100%' }}>
                <span style={{ display: 'block', fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', color: '#94A3B8', lineHeight: 1 }}>
                  Ciudad
                </span>
                <select
                  value={selectedCiudad}
                  onChange={(e) => setSelectedCiudad(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    fontSize: '13px',
                    fontWeight: 700,
                    color: '#0F172A',
                    cursor: 'pointer',
                    padding: 0,
                    marginTop: '2px',
                  }}
                >
                  {ciudadesDisponibles.map((c) => (
                    <option key={c} value={c}>{c}, Argentina</option>
                  ))}
                </select>
              </div>
            </div>

            {/* 2. Deporte */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              borderRadius: '12px',
              background: '#F8FAFC',
            }}>
              <Trophy size={16} color="#00B050" style={{ flexShrink: 0 }} />
              <div style={{ width: '100%' }}>
                <span style={{ display: 'block', fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', color: '#94A3B8', lineHeight: 1 }}>
                  Deporte
                </span>
                <select
                  value={selectedDeporte}
                  onChange={(e) => setSelectedDeporte(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    fontSize: '13px',
                    fontWeight: 700,
                    color: '#0F172A',
                    cursor: 'pointer',
                    padding: 0,
                    marginTop: '2px',
                  }}
                >
                  {DEPORTES_CATALOGO.map((dep) => (
                    <option key={dep.id} value={dep.id}>{dep.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* 3. Fecha */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              borderRadius: '12px',
              background: '#F8FAFC',
            }}>
              <Calendar size={16} color="#00B050" style={{ flexShrink: 0 }} />
              <div style={{ width: '100%' }}>
                <span style={{ display: 'block', fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', color: '#94A3B8', lineHeight: 1 }}>
                  Fecha
                </span>
                <select
                  value={selectedFecha}
                  onChange={(e) => setSelectedFecha(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    fontSize: '13px',
                    fontWeight: 700,
                    color: '#0F172A',
                    cursor: 'pointer',
                    padding: 0,
                    marginTop: '2px',
                  }}
                >
                  {opcionesFechas.map((f) => (
                    <option key={f.iso} value={f.iso}>{f.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* 4. Horario */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              borderRadius: '12px',
              background: '#F8FAFC',
            }}>
              <Clock size={16} color="#00B050" style={{ flexShrink: 0 }} />
              <div style={{ width: '100%' }}>
                <span style={{ display: 'block', fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', color: '#94A3B8', lineHeight: 1 }}>
                  Horario
                </span>
                <select
                  value={selectedHora}
                  onChange={(e) => setSelectedHora(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    fontSize: '13px',
                    fontWeight: 700,
                    color: '#0F172A',
                    cursor: 'pointer',
                    padding: 0,
                    marginTop: '2px',
                  }}
                >
                  <option value="todas">Cualquier hora</option>
                  <option value="08:00">08:00 hs</option>
                  <option value="09:00">09:00 hs</option>
                  <option value="10:00">10:00 hs</option>
                  <option value="11:30">11:30 hs</option>
                  <option value="13:00">13:00 hs</option>
                  <option value="14:00">14:00 hs</option>
                  <option value="15:00">15:00 hs</option>
                  <option value="16:00">16:00 hs</option>
                  <option value="17:00">17:00 hs</option>
                  <option value="18:00">18:00 hs</option>
                  <option value="19:00">19:00 hs</option>
                  <option value="19:30">19:30 hs</option>
                  <option value="20:00">20:00 hs</option>
                  <option value="20:30">20:30 hs</option>
                  <option value="21:00">21:00 hs</option>
                  <option value="22:00">22:00 hs</option>
                  <option value="22:30">22:30 hs</option>
                  <option value="23:00">23:00 hs</option>
                </select>
              </div>
            </div>

          </div>
        </div>

        {/* ── FILTROS SECUNDARIOS (Barra de Pills) ── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          overflowX: 'auto',
          paddingTop: '10px',
          scrollbarWidth: 'none',
        }}>
          {/* Ordenar */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '5px 10px',
            borderRadius: '99px',
            border: '1px solid #CBD5E1',
            background: '#FFFFFF',
            fontSize: '11px',
            fontWeight: 700,
            color: '#475569',
            flexShrink: 0,
          }}>
            <SlidersHorizontal size={11} />
            <select
              value={ordenarPor}
              onChange={(e) => setOrdenarPor(e.target.value as any)}
              style={{ background: 'transparent', border: 'none', outline: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 700, color: '#334155' }}
            >
              <option value="relevancia">Ordenar: Relevancia</option>
              <option value="turnos">Ordenar: Más turnos</option>
              <option value="nombre">Ordenar: Nombre A-Z</option>
            </select>
          </div>

          {/* Duración */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '5px 10px',
            borderRadius: '99px',
            border: selectedDuracion !== 'todas' ? '1px solid #00B050' : '1px solid #CBD5E1',
            background: selectedDuracion !== 'todas' ? '#F0FDF4' : '#FFFFFF',
            color: selectedDuracion !== 'todas' ? '#166534' : '#475569',
            fontSize: '11px',
            fontWeight: 700,
            flexShrink: 0,
          }}>
            <span>Duración:</span>
            <select
              value={selectedDuracion}
              onChange={(e) => setSelectedDuracion(e.target.value)}
              style={{ background: 'transparent', border: 'none', outline: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 700, color: 'inherit' }}
            >
              <option value="todas">Todas</option>
              <option value="60">60 min</option>
              <option value="90">90 min</option>
              <option value="120">120 min</option>
            </select>
          </div>

          {/* Cerramiento */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '5px 10px',
            borderRadius: '99px',
            border: '1px solid #CBD5E1',
            background: '#FFFFFF',
            fontSize: '11px',
            fontWeight: 700,
            color: '#475569',
            flexShrink: 0,
          }}>
            <span>Cerramiento:</span>
            <select
              value={selectedCerramiento}
              onChange={(e) => setSelectedCerramiento(e.target.value)}
              style={{ background: 'transparent', border: 'none', outline: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 700, color: '#334155' }}
            >
              <option value="todas">Todos</option>
              <option value="cubierta">Techada / Cubierta</option>
              <option value="descubierta">Descubierta</option>
            </select>
          </div>
        </div>

      </div>

      {/* ── CONTADOR DE RESULTADOS ── */}
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '16px 16px 8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <h2 style={{
          fontFamily: "'Poppins', sans-serif",
          fontSize: '15px',
          fontWeight: 700,
          color: '#334155',
          margin: 0,
        }}>
          {!isLoadingClubs && !isLoadingDisponibilidad
            ? clubesVisibles.length > 0
              ? `${clubesVisibles.length} ${clubesVisibles.length === 1 ? 'club encontrado' : 'clubes encontrados'} con disponibilidad en ${selectedCiudad}, Argentina`
              : `Sin canchas disponibles en ${selectedCiudad} para este filtro`
            : `Buscando canchas en ${selectedCiudad}...`}
        </h2>
      </div>

      {/* ── ESTADO DE CARGA ── */}
      {(isLoadingClubs || isLoadingDisponibilidad) && (
        <div style={{ padding: '40px 16px', textAlign: 'center' }}>
          <div style={{
            width: 38,
            height: 38,
            borderRadius: '50%',
            border: '3px solid #CBD5E1',
            borderTopColor: '#00B050',
            animation: 'spin 0.8s linear infinite',
            margin: '0 auto 12px',
          }} />
          <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#64748B', margin: 0 }}>
            Consultando turnos en vivo en los clubes de {selectedCiudad}...
          </p>
        </div>
      )}

      {/* ── ESTADO VACÍO (CUANDO NINGÚN CLUB TIENE TURNOS DISPONIBLES EN ESE FILTRO) ── */}
      {!isLoadingClubs && !isLoadingDisponibilidad && clubesVisibles.length === 0 && (
        <div style={{
          maxWidth: '560px',
          margin: '36px auto',
          padding: '36px 24px',
          background: '#FFFFFF',
          borderRadius: '20px',
          textAlign: 'center',
          border: '1.5px solid #E2E8F0',
          boxShadow: '0 4px 20px rgba(0,0,0,0.04)',
        }}>
          <div style={{
            width: '54px',
            height: '54px',
            borderRadius: '50%',
            background: '#FEF3C7',
            color: '#D97706',
            display: 'grid',
            placeItems: 'center',
            margin: '0 auto 16px',
            fontSize: '24px',
          }}>
            ⏰
          </div>
          <h3 style={{ fontFamily: "'Poppins', sans-serif", fontSize: '18px', fontWeight: 800, color: '#0F172A', margin: '0 0 8px' }}>
            No hay canchas disponibles en ese horario
          </h3>
          <p style={{ fontSize: '13px', color: '#64748B', margin: '0 0 20px', lineHeight: 1.5 }}>
            Todos los turnos para este horario ya están reservados o el club se encuentra cerrado. Probá seleccionando otro horario o fecha.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setSelectedHora('todas')}
              style={{
                background: '#00B050',
                color: '#FFFFFF',
                fontWeight: 700,
                fontSize: '13px',
                padding: '10px 20px',
                borderRadius: '99px',
                border: 'none',
                cursor: 'pointer',
                transition: 'opacity 0.15s ease',
              }}
            >
              Ver todos los horarios del día
            </button>
          </div>
        </div>
      )}

      {/* ── GRILLA DE CARDS DE CLUBES (SOLO LOS QUE TIENEN TURNOS LIBRES) ── */}
      {!isLoadingClubs && !isLoadingDisponibilidad && clubesVisibles.length > 0 && (
        <div style={{
          maxWidth: '1200px',
          margin: '0 auto',
          padding: '8px 16px 24px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '20px',
        }}>
          {clubesVisibles.map((club) => {
            const dataDisp = disponibilidadPorClub.get(club.slug);
            const pills = dataDisp?.pillsVisibles ?? [];
            const logoUrl = getLogoClubUrl(club.logo_path ?? null);

            // Precio estimado
            const precioTag = PRECIOS_ESTIMADOS[club.slug] ?? '$18.000';

            return (
              <div
                key={club.id}
                onClick={() => onSelectClub(club.slug, selectedFecha, pills[0] || (selectedHora !== 'todas' ? selectedHora : undefined))}
                style={{
                  background: '#FFFFFF',
                  borderRadius: '16px',
                  overflow: 'hidden',
                  border: '1px solid #E2E8F0',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-3px)';
                  e.currentTarget.style.boxShadow = '0 8px 20px rgba(0,0,0,0.08)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.04)';
                }}
              >
                {/* ── FOTO DE PORTADA REAL O BANNER DE MARCA CON LOGO ── */}
                <div style={{ position: 'relative', width: '100%', paddingTop: '52%', background: '#0B1F4D', overflow: 'hidden' }}>
                  {club.portada_url ? (
                    <>
                      <img
                        src={club.portada_url}
                        alt={club.nombre}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          transition: 'transform 0.3s ease',
                        }}
                      />
                      <div style={{
                        position: 'absolute',
                        inset: 0,
                        background: 'linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.65) 100%)',
                      }} />
                      {logoUrl && (
                        <div style={{
                          position: 'absolute',
                          top: '10px',
                          left: '10px',
                          width: '42px',
                          height: '42px',
                          borderRadius: '10px',
                          background: '#FFFFFF',
                          padding: '3px',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                          <img
                            src={logoUrl}
                            alt="Logo"
                            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                            onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }}
                          />
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'linear-gradient(135deg, #0B1F4D 0%, #172554 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                      {/* Pista de pádel sutil de fondo */}
                      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.15 }} viewBox="0 0 200 100" fill="none" stroke="#FFFFFF" strokeWidth="1">
                        <rect x="10" y="10" width="180" height="80" rx="4" />
                        <line x1="100" y1="10" x2="100" y2="90" />
                        <line x1="50" y1="10" x2="50" y2="90" />
                        <line x1="150" y1="10" x2="150" y2="90" />
                        <line x1="10" y1="50" x2="190" y2="50" />
                      </svg>

                      {/* Logo real o iniciales */}
                      {logoUrl ? (
                        <div style={{
                          width: '64px',
                          height: '64px',
                          borderRadius: '16px',
                          background: '#FFFFFF',
                          padding: '6px',
                          boxShadow: '0 4px 14px rgba(0,0,0,0.3)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          zIndex: 2,
                        }}>
                          <img
                            src={logoUrl}
                            alt={club.nombre}
                            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                          />
                        </div>
                      ) : (
                        <div style={{
                          width: '60px',
                          height: '60px',
                          borderRadius: '16px',
                          background: 'rgba(255,255,255,0.12)',
                          border: '1.5px solid rgba(255,255,255,0.25)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#D9F23B',
                          fontSize: '20px',
                          fontWeight: 900,
                          fontFamily: "'Poppins', sans-serif",
                          zIndex: 2,
                        }}>
                          {club.nombre.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Badge de precio en la esquina inferior derecha */}
                  <div style={{
                    position: 'absolute',
                    bottom: '10px',
                    right: '10px',
                    textAlign: 'right',
                    color: '#FFFFFF',
                    zIndex: 2,
                  }}>
                    <span style={{ fontSize: '10px', opacity: 0.85, display: 'block', lineHeight: 1 }}>desde</span>
                    <span style={{ fontSize: '16px', fontWeight: 900, fontFamily: "'Poppins', sans-serif" }}>
                      {precioTag}
                    </span>
                  </div>
                </div>

                {/* ── CUERPO DE LA CARD ── */}
                <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', flex: 1 }}>
                  {/* Nombre del Club */}
                  <h3 style={{
                    fontFamily: "'Poppins', sans-serif",
                    fontSize: '16px',
                    fontWeight: 800,
                    color: '#0F172A',
                    margin: '0 0 4px',
                    lineHeight: 1.3,
                  }}>
                    {club.nombre}
                  </h3>

                  {/* Ubicación */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    color: '#64748B',
                    fontSize: '12px',
                    marginBottom: '14px',
                  }}>
                    <MapPin size={13} color="#94A3B8" style={{ flexShrink: 0 }} />
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {club.direccion ? `${club.direccion}, ${club.ciudad ?? 'Salta'}` : `${club.ciudad ?? 'Salta'}, Argentina`}
                    </span>
                  </div>

                  {/* ── HORARIOS DISPONIBLES EN PÍLDORAS ── */}
                  <div style={{ marginTop: 'auto', paddingTop: '8px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                      {pills.map((horaSlot) => (
                        <button
                          key={horaSlot}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectClub(club.slug, selectedFecha, horaSlot);
                          }}
                          style={{
                            padding: '6px 14px',
                            borderRadius: '99px',
                            background: '#FFFFFF',
                            color: '#0F172A',
                            border: '1.5px solid #CBD5E1',
                            fontSize: '12px',
                            fontWeight: 800,
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = '#00B050';
                            e.currentTarget.style.color = '#00B050';
                            e.currentTarget.style.background = '#F0FDF4';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = '#CBD5E1';
                            e.currentTarget.style.color = '#0F172A';
                            e.currentTarget.style.background = '#FFFFFF';
                          }}
                        >
                          {horaSlot}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
