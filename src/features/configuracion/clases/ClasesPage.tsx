import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
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
import { useCanchas } from '@/features/configuracion/hooks/useCanchas';
import {
  useClases,
  useDeleteClase,
  type ClaseConProfesor,
} from '@/features/configuracion/hooks/useClases';
import type { Cancha } from '@/types/database';
import { ClaseFormDialog } from './ClaseFormDialog';

const DIAS_ABBR: Record<number, string> = {
  1: 'LUN',
  2: 'MAR',
  3: 'MIE',
  4: 'JUE',
  5: 'VIE',
  6: 'SAB',
  7: 'DOM',
};

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

function formatHorarioRango(horaInicio: string, duracionMin: number): string {
  const [hStr, mStr] = horaInicio.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return formatHora(horaInicio);
  const total = h * 60 + m + duracionMin;
  const fh = Math.floor(total / 60) % 24;
  const fm = total % 60;
  const horaFin = `${String(fh).padStart(2, '0')}:${String(fm).padStart(2, '0')}`;
  return `${formatHora(horaInicio)}–${horaFin}`;
}

export function ClasesPage() {
  const { user } = useSession();
  const isAdmin = user?.rol === 'admin';

  const clasesQuery = useClases();
  const canchasQuery = useCanchas();
  const deleteMutation = useDeleteClase();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ClaseConProfesor | null>(null);
  const [toDelete, setToDelete] = useState<ClaseConProfesor | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const canchasMap = useMemo(() => {
    const m = new Map<number, Cancha>();
    for (const c of canchasQuery.data ?? []) m.set(c.id, c);
    return m;
  }, [canchasQuery.data]);

  function openNew(): void {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(c: ClaseConProfesor): void {
    setEditing(c);
    setFormOpen(true);
  }

  function requestDelete(c: ClaseConProfesor): void {
    setDeleteError(null);
    setToDelete(c);
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
          : 'No pudimos eliminar la clase. Probá de nuevo.',
      );
    }
  }

  return (
    <section className="space-y-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Clases
          </h2>
          <p className="text-sm text-muted-foreground">
            Bloques rígidos recurrentes semanales. Aparecen pre-marcados en
            la grilla del día y no son reservables como turno normal.
          </p>
        </div>
        {isAdmin && (
          <Button type="button" onClick={openNew} className="shrink-0">
            <Plus className="h-4 w-4" />
            Agregar clase
          </Button>
        )}
      </header>

      <ClasesTable
        query={clasesQuery}
        canchasMap={canchasMap}
        isAdmin={isAdmin}
        onEdit={openEdit}
        onDelete={requestDelete}
      />

      <ClaseFormDialog
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
            <DialogTitle>¿Eliminar clase?</DialogTitle>
            <DialogDescription>
              Esta acción no se puede deshacer. La clase se va a eliminar
              de forma permanente — los slots que ocupaba quedan libres
              en la grilla.
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

interface ClasesTableProps {
  query: ReturnType<typeof useClases>;
  canchasMap: Map<number, Cancha>;
  isAdmin: boolean;
  onEdit: (c: ClaseConProfesor) => void;
  onDelete: (c: ClaseConProfesor) => void;
}

function ClasesTable({
  query,
  canchasMap,
  isAdmin,
  onEdit,
  onDelete,
}: ClasesTableProps) {
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

  const clases = query.data ?? [];

  if (clases.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted-foreground">
          {isAdmin
            ? 'Todavía no configuraste clases. Agregá una para reservar slots fijos en la grilla.'
            : 'El administrador todavía no configuró clases.'}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2 font-medium">Profesor</th>
            <th className="px-3 py-2 font-medium">Cancha</th>
            <th className="px-3 py-2 font-medium">Días</th>
            <th className="px-3 py-2 font-medium">Horario</th>
            <th className="px-3 py-2 font-medium">Duración</th>
            <th className="px-3 py-2 font-medium">Precio</th>
            <th className="px-3 py-2 font-medium">Estado</th>
            {isAdmin && (
              <th className="w-1 px-3 py-2 text-right font-medium">
                <span className="sr-only">Acciones</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {clases.map((c) => {
            const profesorNombre = c.profesor?.nombre ?? '—';
            const canchaNombre = canchasMap.get(c.cancha_id)?.nombre ?? '—';
            return (
              <tr
                key={c.id}
                className={cn(
                  'border-b border-border last:border-b-0 transition-colors',
                  !c.activa && 'bg-muted/20',
                )}
              >
                <td
                  className={cn(
                    'px-3 py-3 font-medium',
                    c.activa ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  <div>{profesorNombre}</div>
                  {c.nombre && (
                    <div className="text-xs font-normal text-muted-foreground">
                      {c.nombre}
                    </div>
                  )}
                </td>
                <td className="px-3 py-3 text-muted-foreground">
                  {canchaNombre}
                </td>
                <td className="px-3 py-3 text-muted-foreground">
                  {formatDias(c.dias_semana)}
                </td>
                <td className="px-3 py-3 tabular-nums text-muted-foreground">
                  {formatHorarioRango(c.hora_inicio, c.duracion_min)}
                </td>
                <td className="px-3 py-3 tabular-nums text-foreground">
                  {c.duracion_min} min
                </td>
                <td className="px-3 py-3 tabular-nums text-foreground">
                  {montoFormatter.format(c.precio)}
                </td>
                <td className="px-3 py-3">
                  {c.activa ? (
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
                        onClick={() => onEdit(c)}
                        aria-label={`Editar clase de ${profesorNombre}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(c)}
                        aria-label={`Eliminar clase de ${profesorNombre}`}
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
