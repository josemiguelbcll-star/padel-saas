import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSession } from '@/features/auth';
import { useTurnosCajaHistorial } from '@/features/caja/hooks/useTurnosCajaHistorial';
import { useInformeTurno, type InformeTurnoData } from './hooks/useInformeTurno';
import { useInformeDia, type InformeDiarioData } from './hooks/useInformeDia';
import { InformeDiarioView } from './components/InformeDiarioView';
import { exportarInformeDiarioPdf } from './utils/exportarInformeDiarioPdf';
import { fechaHoy } from '@/features/reservas/utils/fechaUtils';
import { Input } from '@/components/ui/input';

type ModoInforme = 'turno' | 'dia';

const AR_TZ = 'America/Argentina/Buenos_Aires';

const horaFmt = new Intl.DateTimeFormat('es-AR', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: AR_TZ,
});

/**
 * Arma el mismo documento visual, pero con caja/arqueo/cobros de UNA jornada.
 * No cambia el layout: solo el recorte de datos que recibe InformeDiarioView.
 */
function alcanceJornada(
  dia: InformeDiarioData,
  jornada: InformeTurnoData,
): InformeDiarioData {
  return {
    ...dia,
    facturacion: jornada.porMedio.total,
    cobros: jornada.cobros,
    porMedio: jornada.porMedio,
    unidades: jornada.unidades,
    buffetShop: {
      ...dia.buffetShop,
      ventas: jornada.unidades.buffet + jornada.unidades.shop,
      topProductos: jornada.topProductos,
    },
    jornadas: [{ turno: jornada.turno, arqueo: jornada.arqueo }],
  };
}

export function InformeTurnoPage() {
  const { club } = useSession();
  const [modo, setModo] = useState<ModoInforme>('dia');
  const [fecha, setFecha] = useState(fechaHoy());
  const [turnoId, setTurnoId] = useState<number | null>(null);

  const turnosQuery = useTurnosCajaHistorial();
  const turnos = turnosQuery.data ?? [];
  const jornadasDelDia = turnos.filter((t) => t.fecha_jornada === fecha);
  const turnoSelId =
    jornadasDelDia.some((t) => t.id === turnoId)
      ? turnoId
      : (jornadasDelDia[0]?.id ?? null);

  const diaQuery = useInformeDia(fecha);
  const jornadaQuery = useInformeTurno(modo === 'turno' ? turnoSelId : null);

  const informeBase = diaQuery.data ?? null;
  const informe: InformeDiarioData | null = useMemo(() => {
    if (!informeBase) return null;
    if (modo !== 'turno') return informeBase;
    if (!jornadaQuery.data) return null;
    return alcanceJornada(informeBase, jornadaQuery.data);
  }, [informeBase, modo, jornadaQuery.data]);

  const cargando =
    diaQuery.isLoading || (modo === 'turno' && jornadaQuery.isLoading);
  const error = diaQuery.error ?? (modo === 'turno' ? jornadaQuery.error : null);
  const [exportando, setExportando] = useState(false);

  async function descargarPdf() {
    if (!informe || exportando) return;
    setExportando(true);
    try {
      await exportarInformeDiarioPdf(informe, club?.nombre ?? '');
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Informe de caja
        </h1>
        <p className="text-sm text-muted-foreground">
          {club?.nombre ? `${club.nombre} · ` : ''}
          Por jornada de caja o día completo
        </p>
      </header>

      <div className="flex gap-1 w-fit rounded-lg border border-border bg-muted/30 p-1">
        {(
          [
            { key: 'turno', label: 'Por jornada' },
            { key: 'dia', label: 'Día completo' },
          ] as const
        ).map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setModo(m.key)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              modo === m.key
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <label
              htmlFor="informe-fecha"
              className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              {modo === 'turno' ? 'Día de caja' : 'Fecha del cierre'}
            </label>
            <Input
              id="informe-fecha"
              type="date"
              value={fecha}
              onChange={(e) => {
                setFecha(e.target.value);
                setTurnoId(null);
              }}
              className="h-9 w-auto bg-background"
            />
            {modo === 'turno' && (
              <span className="text-xs text-muted-foreground">
                {jornadasDelDia.length}{' '}
                {jornadasDelDia.length === 1 ? 'jornada' : 'jornadas'}
              </span>
            )}
          </div>

          {modo === 'turno' && !turnosQuery.isLoading && jornadasDelDia.length === 0 && (
            <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
              No hay jornadas de caja para ese día. Elegí otra fecha.
            </p>
          )}

          {modo === 'turno' && jornadasDelDia.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {jornadasDelDia.map((turno) => {
                const seleccionada = turno.id === turnoSelId;
                const apertura = horaFmt.format(new Date(turno.abierta_en));
                const cierre = turno.cerrada_en
                  ? horaFmt.format(new Date(turno.cerrada_en))
                  : null;
                return (
                  <button
                    key={turno.id}
                    type="button"
                    onClick={() => setTurnoId(turno.id)}
                    aria-pressed={seleccionada}
                    className={cn(
                      'rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      seleccionada
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-card hover:bg-muted/40',
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {apertura}
                        {cierre ? `–${cierre}` : ' · Abierta'}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        #{turno.id}
                      </span>
                    </span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {turno.vendedorNombre ?? 'Responsable sin nombre'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <button
          type="button"
          disabled={!informe || cargando || exportando}
          onClick={() => void descargarPdf()}
          className="inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: 'hsl(var(--inf-green-fijo))' }}
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          {exportando ? 'Generando PDF…' : 'Descargar PDF'}
        </button>
      </div>

      {cargando && (
        <div className="space-y-3" aria-busy="true">
          <div className="h-16 animate-pulse rounded-2xl bg-muted" />
          <div className="grid gap-3 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl bg-muted" />
            ))}
          </div>
          <div className="h-64 animate-pulse rounded-2xl bg-muted" />
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {error.message}
        </p>
      )}
      {informe && !cargando && (
        <InformeDiarioView informe={informe} nombreClub={club?.nombre ?? ''} />
      )}
    </div>
  );
}
