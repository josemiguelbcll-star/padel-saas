import { useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import {
  MapPin, Clock, Phone, Globe, Instagram,
  ChevronLeft, Search, SlidersHorizontal, CalendarDays,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getLogoClubUrl } from '@/lib/clubBrand';
import { useClubPublico, type FotoClub, type CanchaPublica } from './hooks/useClubPublico';
import { useDisponibilidadClub, type SlotDisponible } from './hooks/useDisponibilidadClub';

// ─── helpers ───────────────────────────────────────────────────────────────

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function addDays(iso: string, n: number) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function calcDuracion(hi: string, hf: string): number {
  const parts1 = hi.slice(0, 5).split(':').map(Number);
  const parts2 = hf.slice(0, 5).split(':').map(Number);
  const h1 = parts1[0] ?? 0, m1 = parts1[1] ?? 0;
  const h2 = parts2[0] ?? 0, m2 = parts2[1] ?? 0;
  return (h2 * 60 + m2) - (h1 * 60 + m1);
}
function formatTime(t: string) { return t.length >= 5 ? t.slice(0, 5) : t; }

// ─── data helpers ──────────────────────────────────────────────────────────

/** Unique disponible hora_inicio values, sorted. */
function availableTimes(slots: SlotDisponible[]): string[] {
  const set = new Set<string>();
  for (const s of slots) if (s.disponible) set.add(s.hora_inicio.slice(0, 5));
  return [...set].sort();
}

interface CourtAvail {
  canchaId: number;
  canchaName: string;
  slots: SlotDisponible[];
}

/** Courts with available slots at a given hora (HH:MM). */
function courtsAtTime(slots: SlotDisponible[], hora: string): CourtAvail[] {
  const map = new Map<number, CourtAvail>();
  for (const s of slots) {
    if (!s.disponible || s.hora_inicio.slice(0, 5) !== hora) continue;
    if (!map.has(s.cancha_id)) {
      map.set(s.cancha_id, { canchaId: s.cancha_id, canchaName: s.cancha_nombre, slots: [] });
    }
    map.get(s.cancha_id)!.slots.push(s);
  }
  return [...map.values()].sort((a, b) => a.canchaName.localeCompare(b.canchaName));
}

// ─── CourtCard ─────────────────────────────────────────────────────────────

interface CourtCardProps {
  court: CourtAvail;
  cancha: CanchaPublica | undefined;
  contactHref: string | null;
  contactIsExternal: boolean;
  hasTelefono: boolean;
}

function CourtCard({ court, cancha, contactHref, contactIsExternal, hasTelefono }: CourtCardProps) {
  const sorted = [...court.slots].sort(
    (a, b) => calcDuracion(a.hora_inicio, a.hora_fin) - calcDuracion(b.hora_inicio, b.hora_fin),
  );
  const [selFin, setSelFin] = useState(sorted[0]?.hora_fin ?? '');

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      {/* Court info */}
      <div className="px-4 pt-4 pb-3">
        <h3 className="text-base font-black text-foreground">{court.canchaName}</h3>
        {cancha && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[cancha.tipo, cancha.cubierta != null ? (cancha.cubierta ? 'Cubierta' : 'Descubierta') : null]
              .filter(Boolean).join(' · ')}
          </p>
        )}
      </div>

      {/* Duration chips */}
      <div className="flex flex-wrap gap-2 px-4 pb-4">
        {sorted.map(s => {
          const dur = calcDuracion(s.hora_inicio, s.hora_fin);
          const sel = s.hora_fin === selFin;
          return (
            <button
              key={s.hora_fin}
              onClick={() => setSelFin(s.hora_fin)}
              className={cn(
                'flex flex-col items-center rounded-xl px-5 py-2.5 transition-all',
                sel
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'border border-border bg-background text-foreground hover:border-primary/50',
              )}
            >
              <span className="text-base font-black leading-none">{dur} min</span>
              <span className={cn('mt-0.5 text-[10px] tabular-nums', sel ? 'text-primary-foreground/75' : 'text-muted-foreground')}>
                {formatTime(s.hora_inicio)}–{formatTime(s.hora_fin)}
              </span>
            </button>
          );
        })}
      </div>

      {/* CTA */}
      <div className="border-t border-border/40 px-4 py-3">
        {contactHref ? (
          <a
            href={contactHref}
            target={contactIsExternal ? '_blank' : undefined}
            rel={contactIsExternal ? 'noopener noreferrer' : undefined}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-extrabold text-primary-foreground transition active:scale-[0.98] hover:opacity-90"
          >
            {hasTelefono
              ? <><Phone className="h-4 w-4" />Llamar para reservar</>
              : <><Instagram className="h-4 w-4" />Reservar por Instagram</>}
          </a>
        ) : (
          <p className="py-1 text-center text-xs text-muted-foreground">Contactá al club para reservar.</p>
        )}
      </div>
    </div>
  );
}

// ─── main page ─────────────────────────────────────────────────────────────

const DAYS_AHEAD = 7;

export function ClubProfilePage({ slugProp, onBack }: { slugProp?: string; onBack?: () => void } = {}) {
  const params = useParams<{ slug: string }>();
  const slug = slugProp ?? params.slug;
  const [searchParams] = useSearchParams();
  const paramFecha  = searchParams.get('fecha');
  const paramHora   = searchParams.get('hora') ?? searchParams.get('horario');
  const fromPlayer  = !!onBack || searchParams.get('from') === 'player';
  const backHref    = fromPlayer ? '/player' : '/';

  const { data, isLoading, isError } = useClubPublico(slug ?? '');
  const [fecha, setFecha] = useState(() =>
    paramFecha && paramFecha >= todayISO() ? paramFecha : todayISO(),
  );
  const [selectedHour, setSelectedHour] = useState<string | null>(paramHora);

  const dispQuery = useDisponibilidadClub(slug ?? '', fecha);
  const allSlots  = dispQuery.data ?? [];
  const times     = availableTimes(allSlots);

  function pickDate(d: string) {
    setFecha(d);
    setSelectedHour(null);
  }
  function toggleHour(h: string) {
    setSelectedHour(prev => prev === h ? null : h);
  }

  // ── loading / error ────────────────────────────────────────────────────
  if (isLoading) return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
        <p className="text-sm text-muted-foreground">Cargando…</p>
      </div>
    </div>
  );
  if (isError || !data) return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-bold">Club no encontrado</h1>
      <p className="text-sm text-muted-foreground">Este club no tiene un perfil público activo o la URL es incorrecta.</p>
      <Link to="/" className="rounded-full bg-primary px-6 py-2.5 text-sm font-bold text-primary-foreground">← Volver al inicio</Link>
    </div>
  );

  const { club, canchas, fotos } = data;
  const portada: FotoClub | null  = fotos.find(f => f.es_portada) ?? fotos[0] ?? null;
  const galeria  = fotos.length > 1 ? fotos : [];
  const logoUrl  = getLogoClubUrl(club.logo_path);

  const contactHref       = club.telefono
    ? `tel:${club.telefono}`
    : club.instagram ? `https://instagram.com/${club.instagram.replace('@', '')}` : null;
  const contactIsExternal = contactHref?.startsWith('http') ?? false;
  const hasTelefono       = !!club.telefono;

  const mapSrc = club.lat && club.lng
    ? `https://maps.google.com/maps?q=${club.lat},${club.lng}&z=15&output=embed`
    : club.direccion
      ? `https://maps.google.com/maps?q=${encodeURIComponent([club.direccion, club.ciudad, club.provincia].filter(Boolean).join(', '))}&output=embed`
      : null;

  const DAYS = Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(todayISO(), i));
  const canchasMap = new Map(canchas.map(c => [c.id, c]));
  const courts = selectedHour ? courtsAtTime(allSlots, selectedHour) : [];

  // Apply club's brand color as CSS variable for primary
  const brandStyle = club.color_primario_hsl
    ? ({ '--primary': club.color_primario_hsl } as React.CSSProperties)
    : undefined;

  return (
    <div className="min-h-screen bg-background pb-28 sm:pb-12" style={brandStyle}>

      {/* ── Sticky top nav ── */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b border-border/40 supports-[backdrop-filter]:bg-background/85">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          {onBack ? (
            <button onClick={onBack} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground shadow-sm transition hover:bg-muted">
              <ChevronLeft className="h-4 w-4" />
            </button>
          ) : (
            <Link to={backHref} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground shadow-sm transition hover:bg-muted">
              <ChevronLeft className="h-4 w-4" />
            </Link>
          )}
          <div className="flex flex-1 items-center gap-2 rounded-2xl border border-border bg-card px-3.5 py-2 shadow-sm">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate text-sm font-semibold text-foreground">{club.nombre}</span>
            {(club.ciudad || club.provincia) && (
              <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:flex">
                <MapPin className="h-3 w-3" />{[club.ciudad, club.provincia].filter(Boolean).join(', ')}
              </span>
            )}
          </div>
          <button className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-border bg-card shadow-sm text-muted-foreground hover:bg-muted">
            <SlidersHorizontal className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* ── Hero photo ── */}
      <div className="relative h-52 w-full overflow-hidden bg-muted sm:h-72">
        {portada ? (
          <img src={portada.url} alt={club.nombre} className="h-full w-full object-cover" loading="eager" />
        ) : (
          /* Foto real de cancha como fallback — Pexels licencia libre */
          <img
            src={`https://images.pexels.com/photos/32474981/pexels-photo-32474981/free-photo-of-indoor-padel-court-with-blue-surface.jpeg?auto=compress&cs=tinysrgb&w=1200&h=600&fit=crop`}
            alt={club.nombre}
            className="h-full w-full object-cover"
            loading="eager"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
        <div className="absolute bottom-4 left-4 right-4 flex items-end gap-3">
          {logoUrl && (
            <img src={logoUrl} alt={club.nombre} className="h-14 w-14 shrink-0 rounded-2xl border-2 border-white bg-white p-1.5 shadow-xl sm:h-16 sm:w-16" />
          )}
          <div className="min-w-0 flex-1 pb-0.5">
            <h1 className="truncate text-lg font-black text-white sm:text-2xl">{club.nombre}</h1>
            {(club.ciudad || club.provincia) && (
              <p className="flex items-center gap-1 text-xs text-white/75">
                <MapPin className="h-3 w-3 shrink-0" />{[club.ciudad, club.provincia].filter(Boolean).join(', ')}
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-2 pb-0.5">
            {club.telefono && (
              <a href={`tel:${club.telefono}`} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur transition hover:bg-white/30">
                <Phone className="h-4 w-4" />
              </a>
            )}
            {club.instagram && (
              <a href={`https://instagram.com/${club.instagram.replace('@', '')}`} target="_blank" rel="noopener noreferrer" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur transition hover:bg-white/30">
                <Instagram className="h-4 w-4" />
              </a>
            )}
          </div>
        </div>
      </div>

      {/* ── Date strip (sticky) ── */}
      <div className="sticky top-[61px] z-40 bg-background border-b border-border/40 shadow-sm">
        <div className="mx-auto max-w-2xl px-4 py-3">
          <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            {DAYS.map(d => {
              const dt = new Date(d + 'T12:00:00');
              const isToday = d === todayISO();
              const isSel   = d === fecha;
              return (
                <button
                  key={d}
                  onClick={() => pickDate(d)}
                  className={cn(
                    'flex min-w-[52px] shrink-0 flex-col items-center rounded-2xl px-3 py-2 transition-all duration-150',
                    isSel ? 'bg-primary text-primary-foreground shadow-md scale-105' : 'text-muted-foreground hover:bg-muted/60',
                  )}
                >
                  <span className={cn('text-[10px] font-black uppercase tracking-widest', isSel ? 'text-primary-foreground/80' : 'text-muted-foreground/70')}>
                    {dt.toLocaleDateString('es-AR', { weekday: 'short' })}
                  </span>
                  <span className={cn('text-2xl font-black leading-tight tabular-nums', isSel ? 'text-primary-foreground' : 'text-foreground')}>
                    {dt.getDate()}
                  </span>
                  <span className={cn('text-[9px] font-bold uppercase tracking-wide', isSel ? 'text-primary-foreground/70' : 'text-muted-foreground/60')}>
                    {isToday ? 'HOY' : dt.toLocaleDateString('es-AR', { month: 'short' })}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="mx-auto max-w-2xl px-4 py-5 space-y-6">

        {/* ── TIME PICKER ── */}
        <div>
          {/* Section header */}
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-black uppercase tracking-widest text-foreground">Elegí un horario</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Solo se muestran turnos con canchas disponibles</p>
            </div>
            {selectedHour && (
              <button
                onClick={() => setSelectedHour(null)}
                className="text-xs font-bold text-primary underline underline-offset-2"
              >
                Ver todos
              </button>
            )}
          </div>

          {/* Loading skeleton */}
          {dispQuery.isLoading && (
            <div className="flex flex-wrap gap-2">
              {[1,2,3,4,5,6,7,8].map(i => (
                <div key={i} className="h-14 w-[72px] animate-pulse rounded-2xl bg-muted" />
              ))}
            </div>
          )}

          {/* No availability */}
          {!dispQuery.isLoading && times.length === 0 && (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-muted/20 py-10 text-center">
              <CalendarDays className="h-8 w-8 text-muted-foreground/40" />
              <p className="font-bold text-foreground">Sin turnos disponibles</p>
              <p className="text-sm text-muted-foreground">Probá eligiendo otro día</p>
            </div>
          )}

          {/* Time chips */}
          {!dispQuery.isLoading && times.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {times.map(h => {
                const sel = selectedHour === h;
                return (
                  <button
                    key={h}
                    onClick={() => toggleHour(h)}
                    className={cn(
                      'min-w-[72px] rounded-2xl border-2 px-4 py-3 text-center transition-all duration-150',
                      sel
                        ? 'border-primary bg-primary text-primary-foreground shadow-md scale-[1.04]'
                        : 'border-border bg-card text-foreground hover:border-primary/50 hover:bg-primary/[0.04]',
                    )}
                  >
                    <span className="block text-sm font-black tabular-nums leading-none">{h}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── COURT LIST ── */}
        {selectedHour && courts.length > 0 && (
          <div className="space-y-3">
            {/* Section header */}
            <div>
              <h2 className="text-base font-black text-foreground">
                Reservar una cancha
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {courts.length === 1 ? '1 cancha disponible' : `${courts.length} canchas disponibles`} a las <span className="font-bold text-foreground">{selectedHour}</span>
              </p>
            </div>

            {courts.map(court => (
              <CourtCard
                key={court.canchaId}
                court={court}
                cancha={canchasMap.get(court.canchaId)}
                contactHref={contactHref}
                contactIsExternal={contactIsExternal}
                hasTelefono={hasTelefono}
              />
            ))}
          </div>
        )}

        {/* No courts for selected time (edge case) */}
        {selectedHour && courts.length === 0 && !dispQuery.isLoading && (
          <div className="rounded-2xl border border-dashed border-border bg-muted/20 py-8 text-center">
            <p className="text-sm text-muted-foreground">Sin canchas disponibles a las {selectedHour}.</p>
          </div>
        )}

        {/* ── INFO section ── */}
        {(club.descripcion || club.hora_apertura || club.direccion || club.telefono || club.website || club.instagram) && (
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="px-5 pt-4 pb-3 border-b border-border/40">
              <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Información</h3>
            </div>
            <div className="px-5 py-4 space-y-3">
              {(club.hora_apertura || club.hora_cierre) && (
                <div className="flex items-center gap-3 text-sm">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <Clock className="h-4 w-4 text-primary" />
                  </div>
                  <span className="font-medium text-foreground">
                    {formatTime(club.hora_apertura ?? '–')} – {formatTime(club.hora_cierre ?? '–')}
                  </span>
                </div>
              )}
              {club.direccion && (
                <div className="flex items-start gap-3 text-sm">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <MapPin className="h-4 w-4 text-primary" />
                  </div>
                  <span className="text-foreground">{club.direccion}{club.ciudad ? `, ${club.ciudad}` : ''}</span>
                </div>
              )}
              {club.telefono && (
                <a href={`tel:${club.telefono}`} className="flex items-center gap-3 text-sm group">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <Phone className="h-4 w-4 text-primary" />
                  </div>
                  <span className="text-foreground group-hover:underline">{club.telefono}</span>
                </a>
              )}
              {club.website && (
                <a href={club.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-sm group">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <Globe className="h-4 w-4 text-primary" />
                  </div>
                  <span className="truncate text-foreground group-hover:underline">{club.website.replace(/^https?:\/\//, '')}</span>
                </a>
              )}
              {club.instagram && (
                <a href={`https://instagram.com/${club.instagram.replace('@', '')}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-sm group">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <Instagram className="h-4 w-4 text-primary" />
                  </div>
                  <span className="text-foreground group-hover:underline">@{club.instagram.replace('@', '')}</span>
                </a>
              )}
              {club.descripcion && (
                <p className="pt-1 text-sm leading-relaxed text-muted-foreground border-t border-border/40">{club.descripcion}</p>
              )}
            </div>
          </div>
        )}

        {/* ── Map ── */}
        {mapSrc && (
          <div className="overflow-hidden rounded-2xl border border-border shadow-sm">
            <iframe title="Ubicación" width="100%" height="200" style={{ border: 0 }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" src={mapSrc} />
          </div>
        )}

        {/* ── Gallery ── */}
        {galeria.length > 0 && (
          <div>
            <p className="mb-3 text-[11px] font-black uppercase tracking-widest text-muted-foreground">Fotos</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {galeria.map(foto => (
                <div key={foto.id} className="aspect-video overflow-hidden rounded-2xl bg-muted">
                  <img src={foto.url} alt={foto.caption ?? ''} className="h-full w-full object-cover transition-transform hover:scale-105" loading="lazy" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Sticky bottom CTA (mobile only) ── */}
      {contactHref && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-border/40 bg-background/95 px-4 py-3 backdrop-blur sm:hidden supports-[backdrop-filter]:bg-background/85">
          <a
            href={contactHref}
            target={contactIsExternal ? '_blank' : undefined}
            rel={contactIsExternal ? 'noopener noreferrer' : undefined}
            className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-primary py-4 text-base font-extrabold text-primary-foreground shadow-lg transition active:scale-[0.98] hover:opacity-90"
          >
            {hasTelefono ? <><Phone className="h-5 w-5" />Llamar para reservar</> : <><Instagram className="h-5 w-5" />Reservar por Instagram</>}
          </a>
        </div>
      )}
    </div>
  );
}
