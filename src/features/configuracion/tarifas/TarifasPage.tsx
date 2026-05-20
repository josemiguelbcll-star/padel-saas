import { useState } from 'react';
import { Plus, Pencil, Trash2, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useSession } from '@/features/auth';
import {
  useDeleteTarifa,
  useTarifas,
} from '@/features/configuracion/hooks/useTarifas';
import type { Tarifa } from '@/types/database';
import { TarifaFormDialog } from './TarifaFormDialog';

const DIAS_ABBR: Record<number, string> = {
  1: 'LUN',
  2: 'MAR',
  3: 'MIE',
  4: 'JUE',
  5: 'VIE',
  6: 'SAB',
  7: 'DOM',
};

const PRIORIDAD_TOOLTIP =
  'Cuando dos tarifas aplican al mismo horario, gana la de mayor número.';

const montoFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatHora(time: string): string {
  return time.slice(0, 5);
}

function formatDias(dias: number[]): string {
  return dias
    .map((d) => DIAS_ABBR[d] ?? '')
    .filter(Boolean)
    .join(' ');
}

function isTarifaUnica(t: Tarifa): boolean {
  return (
    t.desde_hora === null &&
    t.hasta_hora === null &&
    (t.dias_semana === null || t.dias_semana.length === 0)
  );
}

function describeAplicacion(t: Tarifa): string {
  const partes: string[] = [];
  if (t.dias_semana && t.dias_semana.length > 0) {
    partes.push(formatDias(t.dias_semana));
  }
  if (t.desde_hora && t.hasta_hora) {
    partes.push(`${formatHora(t.desde_hora)}–${formatHora(t.hasta_hora)}`);
  }
  return partes.join(' · ');
}

export function TarifasPage() {
  const { user } = useSession();
  const isAdmin = user?.rol === 'admin';

  const tarifasQuery = useTarifas();
  const deleteMutation = useDeleteTarifa();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Tarifa | null>(null);
  const [toDelete, setToDelete] = useState<Tarifa | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function openNew(): void {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(t: Tarifa): void {
    setEditing(t);
    setFormOpen(true);
  }

  function requestDelete(t: Tarifa): void {
    setDeleteError(null);
    setToDelete(t);
  }

  async function confirmDelete(): Promise<void> {
    if (!toDelete) return;
    setDeleteError(null);
    try {
      await deleteMutation.mutateAsync(toDelete.id);
      setToDelete(null);
    } catch (err) {
      setDeleteError(
        err instanceof Error
          ? err.message
          : 'No pudimos eliminar la tarifa. Probá de nuevo.',
      );
    }
  }

  return (
    <section className="space-y-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Tarifas
          </h2>
          <p className="text-sm text-muted-foreground">
            Configurá el precio de las reservas. Podés tener una tarifa única
            o varias por franja horaria + día de la semana.
          </p>
        </div>
        {isAdmin && (
          <Button type="button" onClick={openNew} className="shrink-0">
            <Plus className="h-4 w-4" />
            Agregar tarifa
          </Button>
        )}
      </header>

      <TarifasTable
        query={tarifasQuery}
        isAdmin={isAdmin}
        onEdit={openEdit}
        onDelete={requestDelete}
      />

      <TarifaFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initialValue={editing}
      />

      <Dialog
        open={!!toDelete}
        onOpenChange={(open) => {
          if (!open) {
            setToDelete(null);
            setDeleteError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Eliminar tarifa?</DialogTitle>
            <DialogDescription>
              Esta acción no se puede deshacer. La tarifa
              {toDelete ? ` "${toDelete.nombre}"` : ''} se va a eliminar
              de forma permanente.
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {deleteError}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setToDelete(null)}
              disabled={deleteMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                void confirmDelete();
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Eliminando…' : 'Eliminar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

interface TarifasTableProps {
  query: ReturnType<typeof useTarifas>;
  isAdmin: boolean;
  onEdit: (t: Tarifa) => void;
  onDelete: (t: Tarifa) => void;
}

function TarifasTable({ query, isAdmin, onEdit, onDelete }: TarifasTableProps) {
  if (query.isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-12 animate-pulse rounded-md border border-border bg-muted/40"
          />
        ))}
      </div>
    );
  }

  if (query.error) {
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
      >
        {query.error.message}
      </div>
    );
  }

  const tarifas = query.data ?? [];

  if (tarifas.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted-foreground">
          {isAdmin
            ? 'Todavía no tenés tarifas configuradas. Agregá una para empezar — el modo "Simple" te deja crearla en dos clics.'
            : 'El administrador todavía no configuró tarifas para el club.'}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2 font-medium">Nombre</th>
            <th className="px-3 py-2 font-medium">Monto</th>
            <th className="px-3 py-2 font-medium">Aplicación</th>
            <th className="px-3 py-2 font-medium">
              <span
                title={PRIORIDAD_TOOLTIP}
                className="inline-flex cursor-help items-center gap-1"
              >
                Prio
                <HelpCircle className="h-3 w-3" aria-hidden="true" />
                <span className="sr-only">: {PRIORIDAD_TOOLTIP}</span>
              </span>
            </th>
            <th className="px-3 py-2 font-medium">Estado</th>
            {isAdmin && (
              <th className="w-1 px-3 py-2 text-right font-medium">
                <span className="sr-only">Acciones</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {tarifas.map((t) => {
            const unica = isTarifaUnica(t);
            const descripcion = describeAplicacion(t);
            return (
              <tr
                key={t.id}
                className={cn(
                  'border-b border-border last:border-b-0 transition-colors',
                  !t.activa && 'bg-muted/20',
                )}
              >
                <td
                  className={cn(
                    'px-3 py-3 font-medium',
                    t.activa ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {t.nombre}
                </td>
                <td className="px-3 py-3 tabular-nums text-foreground">
                  {montoFormatter.format(t.monto)}
                </td>
                <td className="px-3 py-3 text-muted-foreground">
                  {unica ? (
                    <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Tarifa única
                    </span>
                  ) : (
                    <span>{descripcion}</span>
                  )}
                </td>
                <td className="px-3 py-3 tabular-nums text-muted-foreground">
                  {t.prioridad}
                </td>
                <td className="px-3 py-3">
                  {t.activa ? (
                    <span className="text-foreground">Activa</span>
                  ) : (
                    <span className="text-muted-foreground">Inactiva</span>
                  )}
                </td>
                {isAdmin && (
                  <td className="px-3 py-3">
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onEdit(t)}
                        aria-label={`Editar ${t.nombre}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(t)}
                        aria-label={`Eliminar ${t.nombre}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
