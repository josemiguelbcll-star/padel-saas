import { useState } from 'react';
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
import {
  useDeleteProfesor,
  useProfesores,
} from '@/features/configuracion/hooks/useProfesores';
import type { Profesor } from '@/types/database';
import { ProfesorFormDialog } from './ProfesorFormDialog';

export function ProfesoresPage() {
  const { user } = useSession();
  const isAdmin = user?.rol === 'admin';

  const profesoresQuery = useProfesores();
  const deleteMutation = useDeleteProfesor();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Profesor | null>(null);
  const [toDelete, setToDelete] = useState<Profesor | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function openNew(): void {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(p: Profesor): void {
    setEditing(p);
    setFormOpen(true);
  }

  function requestDelete(p: Profesor): void {
    setDeleteError(null);
    setToDelete(p);
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
          : 'No pudimos eliminar el profesor. Probá de nuevo.',
      );
    }
  }

  return (
    <section className="space-y-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Profesores
          </h2>
          <p className="text-sm text-muted-foreground">
            Listado de profesores del club. Se usan al definir clases en
            la grilla.
          </p>
        </div>
        {isAdmin && (
          <Button type="button" onClick={openNew} className="shrink-0">
            <Plus className="h-4 w-4" />
            Agregar profesor
          </Button>
        )}
      </header>

      <ProfesoresTable
        query={profesoresQuery}
        isAdmin={isAdmin}
        onEdit={openEdit}
        onDelete={requestDelete}
      />

      <ProfesorFormDialog
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
            <DialogTitle>¿Eliminar profesor?</DialogTitle>
            <DialogDescription>
              Esta acción no se puede deshacer. El profesor
              {toDelete ? ` "${toDelete.nombre}"` : ''} se va a eliminar
              de forma permanente. Si tiene clases asociadas, primero hay
              que archivar/eliminar esas clases.
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

interface ProfesoresTableProps {
  query: ReturnType<typeof useProfesores>;
  isAdmin: boolean;
  onEdit: (p: Profesor) => void;
  onDelete: (p: Profesor) => void;
}

function ProfesoresTable({
  query,
  isAdmin,
  onEdit,
  onDelete,
}: ProfesoresTableProps) {
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

  const profesores = query.data ?? [];

  if (profesores.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted-foreground">
          {isAdmin
            ? 'Todavía no agregaste profesores. Cargá el primero para empezar a definir clases.'
            : 'El administrador todavía no agregó profesores.'}
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
            <th className="px-3 py-2 font-medium">Teléfono</th>
            <th className="px-3 py-2 font-medium">Email</th>
            <th className="px-3 py-2 font-medium">Notas</th>
            <th className="px-3 py-2 font-medium">Estado</th>
            {isAdmin && (
              <th className="w-1 px-3 py-2 text-right font-medium">
                <span className="sr-only">Acciones</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {profesores.map((p) => (
            <tr
              key={p.id}
              className={cn(
                'border-b border-border last:border-b-0 transition-colors',
                !p.activo && 'bg-muted/20',
              )}
            >
              <td
                className={cn(
                  'px-3 py-3 font-medium',
                  p.activo ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {p.nombre}
              </td>
              <td className="px-3 py-3 text-muted-foreground">
                {p.telefono ?? '—'}
              </td>
              <td className="px-3 py-3 text-muted-foreground">
                {p.email ?? '—'}
              </td>
              <td className="max-w-xs px-3 py-3 text-muted-foreground">
                <span className="block truncate" title={p.notas ?? undefined}>
                  {p.notas ?? '—'}
                </span>
              </td>
              <td className="px-3 py-3">
                {p.activo ? (
                  <span className="text-foreground">Activo</span>
                ) : (
                  <span className="text-muted-foreground">Inactivo</span>
                )}
              </td>
              {isAdmin && (
                <td className="px-3 py-3">
                  <div className="flex justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onEdit(p)}
                      aria-label={`Editar ${p.nombre}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onDelete(p)}
                      aria-label={`Eliminar ${p.nombre}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
