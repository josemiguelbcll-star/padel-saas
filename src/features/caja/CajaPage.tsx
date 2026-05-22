import { useState } from 'react';
import {
  ArrowDownCircle,
  CalendarDays,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Wallet,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { AbrirCajaDialog } from './AbrirCajaDialog';
import { CerrarCajaDialog } from './CerrarCajaDialog';
import { MovimientosCajaList } from './MovimientosCajaList';
import { RegistrarSalidaDialog } from './RegistrarSalidaDialog';
import { useCajaAbierta } from './hooks/useCajaAbierta';
import {
  useMovimientosCaja,
  CAJA_MOVIMIENTOS_QUERY_KEY,
} from './hooks/useMovimientosCaja';
import {
  useResumenCajaAbierta,
  CAJA_RESUMEN_QUERY_KEY,
} from './hooks/useResumenCajaAbierta';
import type { ResumenCaja } from './hooks/useResumenCajaAbierta';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const fechaFmt = new Intl.DateTimeFormat('es-AR', {
  weekday: 'long',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const horaFmt = new Intl.DateTimeFormat('es-AR', {
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Pantalla principal del módulo de Caja.
 *
 * Estados:
 *   A. Cargando.
 *   B. Sin caja abierta → CTA "Abrir caja del día".
 *   C. Con caja abierta → resumen en vivo + acciones (registrar
 *      salida, cerrar) + lista de movimientos manuales.
 *
 * Quién puede operar: admin O vendedor (server-side enforced). El
 * superadmin no llega acá porque no tiene club (su flujo va a /plataforma).
 *
 * REGLA DE ORO: solo entra a la caja el EFECTIVO físico. Los cobros
 * por transferencia / mp / tarjeta NO aparecen en este resumen — viven
 * en los reportes financieros (módulo futuro).
 */
export function CajaPage() {
  const cajaQuery = useCajaAbierta();
  const [abrirOpen, setAbrirOpen] = useState(false);
  const [salidaOpen, setSalidaOpen] = useState(false);
  const [cerrarOpen, setCerrarOpen] = useState(false);

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-6 md:py-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold leading-tight tracking-tight text-foreground">
          Caja
        </h1>
        <p className="text-sm text-muted-foreground">
          Apertura, control del efectivo en vivo y cierre con arqueo.
          Solo se registra el efectivo físico — los cobros por
          transferencia, MP o tarjeta no entran a la caja.
        </p>
      </header>

      {cajaQuery.isLoading && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Cargando caja…
        </div>
      )}

      {cajaQuery.error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {cajaQuery.error.message}
        </div>
      )}

      {cajaQuery.data === null && !cajaQuery.isLoading && (
        <SinCajaAbierta onAbrir={() => setAbrirOpen(true)} />
      )}

      {cajaQuery.data && (
        <CajaAbiertaContent
          caja={cajaQuery.data}
          onRegistrarSalida={() => setSalidaOpen(true)}
          onCerrar={() => setCerrarOpen(true)}
        />
      )}

      <AbrirCajaDialog open={abrirOpen} onOpenChange={setAbrirOpen} />
      {cajaQuery.data && (
        <>
          <RegistrarSalidaDialog
            open={salidaOpen}
            onOpenChange={setSalidaOpen}
            turnoCajaId={cajaQuery.data.id}
          />
          <CerrarCajaDialog
            open={cerrarOpen}
            onOpenChange={setCerrarOpen}
            turnoCajaId={cajaQuery.data.id}
          />
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Estado B: sin caja abierta
// ─────────────────────────────────────────────────────────────────────

function SinCajaAbierta({ onAbrir }: { onAbrir: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Wallet className="h-6 w-6" aria-hidden="true" />
      </div>
      <h2 className="mt-4 text-base font-semibold text-foreground">
        No hay una caja abierta
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Abrí la caja del día para empezar a registrar cobros en efectivo.
        Mientras no haya caja, los cobros en efectivo se van a rechazar.
      </p>
      <div className="mt-4">
        <Button type="button" onClick={onAbrir}>
          <Plus className="h-4 w-4" />
          Abrir caja del día
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Estado C: caja abierta (resumen en vivo + acciones)
// ─────────────────────────────────────────────────────────────────────

interface CajaAbiertaContentProps {
  caja: import('@/types/database').TurnoCaja;
  onRegistrarSalida: () => void;
  onCerrar: () => void;
}

function CajaAbiertaContent({
  caja,
  onRegistrarSalida,
  onCerrar,
}: CajaAbiertaContentProps) {
  const resumenQuery = useResumenCajaAbierta(caja.id);
  const movimientosQuery = useMovimientosCaja(caja.id);
  const queryClient = useQueryClient();

  function refrescar(): void {
    void queryClient.invalidateQueries({
      queryKey: CAJA_RESUMEN_QUERY_KEY(caja.id),
    });
    void queryClient.invalidateQueries({
      queryKey: CAJA_MOVIMIENTOS_QUERY_KEY(caja.id),
    });
  }

  const isRefreshing =
    resumenQuery.isFetching || movimientosQuery.isFetching;

  return (
    <div className="space-y-6">
      {/* Header de la caja */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-primary">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
              Caja abierta — {fechaFmt.format(new Date(caja.fecha_jornada))}
            </div>
            <p className="text-sm text-muted-foreground">
              Apertura {horaFmt.format(new Date(caja.abierta_en))} ·
              {' '}{currencyFmt.format(Number(caja.monto_apertura))}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRegistrarSalida}
            >
              <ArrowDownCircle className="h-4 w-4" />
              Registrar movimiento
            </Button>
            <Button type="button" size="sm" onClick={onCerrar}>
              <Lock className="h-4 w-4" />
              Cerrar caja
            </Button>
          </div>
        </div>
      </div>

      {/* Resumen en vivo */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-foreground">
          Acumulado en vivo
        </h2>
        {resumenQuery.isLoading && (
          <p className="text-xs text-muted-foreground">Calculando…</p>
        )}
        {resumenQuery.error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
          >
            {resumenQuery.error.message}
          </div>
        )}
        {resumenQuery.data && <ResumenCajaCard resumen={resumenQuery.data} />}
      </section>

      {/* Movimientos del día (auditoría) */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-medium text-foreground">
              Movimientos del día
              {movimientosQuery.data && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  ({movimientosQuery.data.length})
                </span>
              )}
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Cobros en efectivo (reservas, buffet, clases) y movimientos
              manuales (retiros, ajustes), en orden cronológico — sirve
              para rastrear faltantes o sobrantes al cierre.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refrescar}
            disabled={isRefreshing}
            aria-label="Actualizar movimientos"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            Actualizar
          </Button>
        </div>
        {movimientosQuery.isLoading && (
          <p className="text-xs text-muted-foreground">Cargando…</p>
        )}
        {movimientosQuery.error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
          >
            {movimientosQuery.error.message}
          </div>
        )}
        {movimientosQuery.data && (
          <MovimientosCajaList movimientos={movimientosQuery.data} />
        )}
      </section>
    </div>
  );
}

function ResumenCajaCard({ resumen }: { resumen: ResumenCaja }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {/* Detalle */}
      <div className="space-y-1.5 rounded-lg border border-border bg-card p-4 text-sm">
        <RowLine label="Apertura" value={currencyFmt.format(resumen.apertura)} />
        <RowLine
          label={`Cobros efectivo (${resumen.count_cobros_efectivo})`}
          value={`+${currencyFmt.format(resumen.entradas_cobros)}`}
        />
        {resumen.ajustes_positivos > 0 && (
          <RowLine
            label="Ajustes (sobrantes)"
            value={`+${currencyFmt.format(resumen.ajustes_positivos)}`}
          />
        )}
        {resumen.salidas > 0 && (
          <RowLine
            label={`Salidas (${resumen.count_salidas})`}
            value={`−${currencyFmt.format(resumen.salidas)}`}
            destructive
          />
        )}
      </div>

      {/* Esperado */}
      <div className="flex flex-col justify-center rounded-lg border border-primary/30 bg-primary/5 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-primary">
          Efectivo esperado
        </p>
        <p className="mt-1 text-3xl font-semibold tabular-nums text-foreground">
          {currencyFmt.format(resumen.esperado)}
        </p>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Lo que debería haber en el cajón al momento del cierre, sumando
          apertura + cobros efectivo + ajustes y restando salidas.
        </p>
      </div>
    </div>
  );
}

function RowLine({
  label,
  value,
  destructive,
}: {
  label: string;
  value: string;
  destructive?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span
        className="tabular-nums"
        style={destructive ? { color: 'hsl(var(--destructive))' } : undefined}
      >
        {value}
      </span>
    </div>
  );
}
