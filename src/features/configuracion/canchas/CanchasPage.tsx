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
  useCanchas,
  useDeleteCancha,
} from '@/features/configuracion/hooks/useCanchas';
import type { Cancha } from '@/types/database';
import { CanchaFormDialog } from './CanchaFormDialog';

export function CanchasPage() {
  const { user } = useSession();
  const isAdmin = user?.rol === 'admin';

  const canchasQuery = useCanchas();
  const deleteMutation = useDeleteCancha();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Cancha | null>(null);
  const [toDelete, setToDelete] = useState<Cancha | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function openNew() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(c: Cancha) {
    setEditing(c);
    setFormOpen(true);
  }

  function requestDelete(c: Cancha) {
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
          : 'No pudimos eliminar la cancha. Probá de nuevo.',
      );
    }
  }

  return (
    <section className="space-y-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Canchas
          </h2>
          <p className="text-sm text-muted-foreground">
            Definí las canchas del club, su tipo y el orden en que aparecen
            en la grilla.
          </p>
        </div>
        {isAdmin && (
          <Button type="button" onClick={openNew} className="shrink-0">
            <Plus className="h-4 w-4" />
            Agregar cancha
          </Button>
        )}
      </header>

      <CanchasTable
        query={canchasQuery}
        isAdmin={isAdmin}
        onEdit={openEdit}
        onDelete={requestDelete}
      />

      <CanchaFormDialog
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
            <DialogTitle>¿Eliminar cancha?</DialogTitle>
            <DialogDescription>
              Esta acción no se puede deshacer. La cancha
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

interface CanchasTableProps {
  query: ReturnType<typeof useCanchas>;
  isAdmin: boolean;
  onEdit: (c: Cancha) => void;
  onDelete: (c: Cancha) => void;
}

function CanchasTable({ query, isAdmin, onEdit, onDelete }: CanchasTableProps) {
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

  const canchas = query.data ?? [];

  if (canchas.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted-foreground">
          {isAdmin
            ? 'Todavía no tenés canchas configuradas. Agregá la primera para empezar.'
            : 'El administrador todavía no configuró canchas para el club.'}
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
            <th className="px-3 py-2 font-medium">Tipo</th>
            <th className="px-3 py-2 font-medium">Cubierta</th>
            <th className="px-3 py-2 font-medium">Estado</th>
            <th className="px-3 py-2 font-medium">Orden</th>
            {isAdmin && (
              <th className="w-1 px-3 py-2 text-right font-medium">
                <span className="sr-only">Acciones</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {canchas.map((c) => (
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
                {c.nombre}
              </td>
              <td className="px-3 py-3 text-muted-foreground">
                {c.tipo ?? '—'}
              </td>
              <td className="px-3 py-3 text-muted-foreground">
                {c.cubierta ? 'Sí' : 'No'}
              </td>
              <td className="px-3 py-3">
                {c.activa ? (
                  <span className="text-foreground">Activa</span>
                ) : (
                  <span className="text-muted-foreground">Inactiva</span>
                )}
              </td>
              <td className="px-3 py-3 tabular-nums text-muted-foreground">
                {c.orden}
              </td>
              {isAdmin && (
                <td className="px-3 py-3">
                  <div className="flex justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onEdit(c)}
                      aria-label={`Editar ${c.nombre}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onDelete(c)}
                      aria-label={`Eliminar ${c.nombre}`}
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
