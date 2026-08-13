import { useEffect, useState } from 'react';
import { AlertTriangle, Building2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { getLogoClubUrl } from '@/lib/clubBrand';
import type { EstadoClub, Plan } from '@/types/database';
import { useCambiarPlanClub } from './hooks/useCambiarPlanClub';
import { useCambiarEstadoClub } from './hooks/useCambiarEstadoClub';
import { useClubesPlataforma } from './hooks/useClubesPlataforma';
import { usePlanesDisponibles } from './hooks/usePlanesDisponibles';
import { useResetearClub } from './hooks/useResetearClub';

const fechaFmt = new Intl.DateTimeFormat('es-AR', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function fmtFecha(iso: string): string {
  return fechaFmt.format(new Date(iso));
}

const ESTADOS_ORDEN: readonly EstadoClub[] = [
  'trial',
  'activo',
  'suspendido',
  'baja',
] as const;

const ESTADO_LABEL: Record<EstadoClub, string> = {
  trial: 'Trial',
  activo: 'Activo',
  suspendido: 'Suspendido',
  baja: 'Baja',
};

const ESTADO_BG: Record<EstadoClub, string> = {
  trial: 'hsl(var(--estado-senada))',
  activo: 'hsl(var(--estado-pagada))',
  suspendido: 'hsl(var(--destructive))',
  baja: 'hsl(var(--muted-foreground))',
};

interface DetalleClubDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Si null, el dialog no muestra nada (se renderiza con open=false). */
  clubId: number | null;
}

/**
 * Modal de gestión de un club desde el panel de plataforma.
 *
 * IMPORTANTE: el dialog lee el club desde el cache de
 * `useClubesPlataforma` usando el clubId — NO recibe el club como
 * prop "snapshot". Razón: cuando una mutation invalida el cache, el
 * dialog refleja inmediatamente los nuevos valores (plan/estado)
 * sin tener que cerrar/reabrir.
 *
 * Confirmaciones:
 *   - Cambio de plan: sin confirmación (reversible, no bloquea acceso).
 *   - Cambio de estado a trial/activo: sin confirmación.
 *   - Cambio de estado a suspendido/baja: confirmación inline
 *     (bloquean el acceso del club al próximo refresh de los usuarios).
 */
export function DetalleClubDialog({
  open,
  onOpenChange,
  clubId,
}: DetalleClubDialogProps) {
  const clubesQuery = useClubesPlataforma();
  const planesQuery = usePlanesDisponibles();
  const cambiarPlan = useCambiarPlanClub();
  const cambiarEstado = useCambiarEstadoClub();
  const resetearMutation = useResetearClub();

  const [error, setError] = useState<string | null>(null);
  const [confirmingEstado, setConfirmingEstado] = useState<EstadoClub | null>(
    null,
  );
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [limpiarCatalogo, setLimpiarCatalogo] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);

  // Reset al abrir o cambiar de club.
  useEffect(() => {
    if (open) {
      setError(null);
      setConfirmingEstado(null);
      setConfirmingReset(false);
      setLimpiarCatalogo(false);
      setResetSuccess(false);
    }
  }, [open, clubId]);

  const club = clubesQuery.data?.find((c) => c.id === clubId) ?? null;
  const planes = planesQuery.data ?? [];
  const anyPending =
    cambiarPlan.isPending || cambiarEstado.isPending || resetearMutation.isPending;

  function handleOpenChange(next: boolean): void {
    if (anyPending) return;
    onOpenChange(next);
  }

  async function aplicarCambioPlan(planId: number): Promise<void> {
    if (!club || planId === club.plan_id) return;
    setError(null);
    try {
      await cambiarPlan.mutateAsync({ clubId: club.id, planId });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No pudimos cambiar el plan.',
      );
    }
  }

  async function aplicarCambioEstado(estado: EstadoClub): Promise<void> {
    if (!club || estado === club.estado) return;
    setError(null);
    try {
      await cambiarEstado.mutateAsync({ clubId: club.id, estado });
      setConfirmingEstado(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No pudimos cambiar el estado.',
      );
    }
  }

  function handleClickEstado(estado: EstadoClub): void {
    if (!club || estado === club.estado) return;
    setError(null);
    if (estado === 'suspendido' || estado === 'baja') {
      setConfirmingEstado(estado);
    } else {
      void aplicarCambioEstado(estado);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        {!club ? (
          <div className="p-2 text-sm text-muted-foreground">
            {clubesQuery.isLoading
              ? 'Cargando datos del club…'
              : 'Club no encontrado.'}
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ClubLogoSm path={club.logo_path} nombre={club.nombre} />
                {club.nombre}
              </DialogTitle>
              <DialogDescription>
                Alta {fmtFecha(club.fecha_alta)} · {club.cantidad_usuarios}{' '}
                usuario{club.cantidad_usuarios === 1 ? '' : 's'} ·{' '}
                {club.cantidad_canchas} cancha
                {club.cantidad_canchas === 1 ? '' : 's'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5">
              {/* Plan */}
              <section className="space-y-2">
                <Label>Plan</Label>
                {planesQuery.isLoading ? (
                  <p className="text-xs text-muted-foreground">
                    Cargando planes…
                  </p>
                ) : planesQuery.error ? (
                  <p className="text-xs text-destructive">
                    {planesQuery.error.message}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {planes.map((p) => (
                      <PlanPill
                        key={p.id}
                        plan={p}
                        active={p.id === club.plan_id}
                        disabled={anyPending}
                        onClick={() => {
                          void aplicarCambioPlan(p.id);
                        }}
                      />
                    ))}
                  </div>
                )}
              </section>

              {/* Estado */}
              <section className="space-y-2">
                <Label>Estado</Label>
                <div className="flex flex-wrap gap-2">
                  {ESTADOS_ORDEN.map((estado) => (
                    <EstadoPill
                      key={estado}
                      estado={estado}
                      active={estado === club.estado}
                      disabled={anyPending || confirmingEstado !== null}
                      onClick={() => handleClickEstado(estado)}
                    />
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  <strong>Suspendido</strong> y <strong>Baja</strong> bloquean
                  el acceso del club: los usuarios no van a poder entrar a
                  partir del próximo refresh.
                </p>
              </section>

              {/* Confirmación inline para suspender / baja */}
              {confirmingEstado && (
                <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle
                      className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
                      aria-hidden="true"
                    />
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">
                        {confirmingEstado === 'suspendido'
                          ? '¿Suspender el acceso del club?'
                          : '¿Dar de baja al club?'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {confirmingEstado === 'suspendido'
                          ? 'Los usuarios del club no van a poder entrar mientras esté suspendido. Podés reactivarlo después cambiando el estado a Activo o Trial.'
                          : 'Los usuarios del club no van a poder entrar. Los datos se conservan pero el club queda fuera de operación.'}
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmingEstado(null)}
                      disabled={anyPending}
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        void aplicarCambioEstado(confirmingEstado);
                      }}
                      disabled={anyPending}
                    >
                      {anyPending
                        ? 'Aplicando…'
                        : confirmingEstado === 'suspendido'
                          ? 'Sí, suspender'
                          : 'Sí, dar de baja'}
                    </Button>
                  </div>
                </div>
              )}

              {/* Zona de Peligro: Resetear datos de prueba */}
              <section className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-semibold text-destructive uppercase tracking-wider">
                      Zona de Control · Resetear Datos
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      Eliminá reservas, cobros, ventas, gastos y cajas de prueba para iniciar el club desde $0.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-destructive/40 text-destructive hover:bg-destructive/10 shrink-0 gap-1.5"
                    onClick={() => setConfirmingReset(true)}
                    disabled={anyPending}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Resetear Datos
                  </Button>
                </div>

                {confirmingReset && (
                  <div className="mt-3 space-y-3 border-t border-destructive/20 pt-3">
                    <div className="space-y-2 text-xs">
                      <p className="font-semibold text-foreground">
                        ¿Confirmás el borrado masivo de datos de prueba para "{club.nombre}"?
                      </p>
                      <label className="flex items-center gap-2 cursor-pointer text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={limpiarCatalogo}
                          onChange={(e) => setLimpiarCatalogo(e.target.checked)}
                          className="rounded border-border"
                        />
                        <span>Limpiar también el catálogo de productos y canchas de prueba</span>
                      </label>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmingReset(false)}
                        disabled={resetearMutation.isPending}
                      >
                        Cancelar
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={async () => {
                          setError(null);
                          try {
                            await resetearMutation.mutateAsync({
                              clubId: club.id,
                              limpiarCatalogo,
                            });
                            setConfirmingReset(false);
                            setResetSuccess(true);
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'Error al resetear datos.');
                          }
                        }}
                        disabled={resetearMutation.isPending}
                      >
                        {resetearMutation.isPending ? 'Reseteando…' : 'Sí, Resetear Cuenta'}
                      </Button>
                    </div>
                  </div>
                )}

                {resetSuccess && (
                  <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    ✓ Datos del club reseteados exitosamente. El club quedó en $0.
                  </p>
                )}
              </section>

              {error && (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
                >
                  {error}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={anyPending}
              >
                Cerrar
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-componentes
// ─────────────────────────────────────────────────────────────────────

function ClubLogoSm({
  path,
  nombre,
}: {
  path: string | null;
  nombre: string;
}) {
  const url = getLogoClubUrl(path);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    setErrored(false);
  }, [path]);

  if (!url || errored) {
    return (
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground"
        aria-label={`Logo de ${nombre} no disponible`}
      >
        <Building2 className="h-4 w-4" aria-hidden="true" />
      </div>
    );
  }

  return (
    <img
      key={path ?? ''}
      src={url}
      alt={`Logo de ${nombre}`}
      onError={() => setErrored(true)}
      className="h-7 w-7 shrink-0 rounded bg-muted/50 object-contain"
    />
  );
}

function PlanPill({
  plan,
  active,
  disabled,
  onClick,
}: {
  plan: Plan;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || active}
      aria-pressed={active}
      className={cn(
        'rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-60',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-foreground hover:bg-muted',
      )}
    >
      {plan.nombre}
    </button>
  );
}

function EstadoPill({
  estado,
  active,
  disabled,
  onClick,
}: {
  estado: EstadoClub;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || active}
      aria-pressed={active}
      className={cn(
        'rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-60',
        !active && 'border-border bg-background text-foreground hover:bg-muted',
      )}
      style={
        active
          ? {
              borderColor: ESTADO_BG[estado],
              backgroundColor: ESTADO_BG[estado],
              color: 'hsl(var(--background))',
            }
          : undefined
      }
    >
      {ESTADO_LABEL[estado]}
    </button>
  );
}
