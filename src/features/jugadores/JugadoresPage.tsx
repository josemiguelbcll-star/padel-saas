import { useMemo, useState } from 'react';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useSession } from '@/features/auth';
import { getPermiso } from '@/lib/permisos';
import {
  useDeleteJugador,
  useJugadores,
} from '@/features/reservas/hooks/useJugadores';
import type { Jugador } from '@/types/database';
import { JugadorFormDialog } from './JugadorFormDialog';
import {
  CATEGORIA_LABEL,
  GENERO_LABEL,
  POSICION_LABEL,
} from './jugadorSchema';

export function JugadoresPage() {
  const { user } = useSession();
  const isAdmin = user?.rol === 'admin';
  const canEdit = getPermiso(user, 'reservas', 'editar');

  const jugadoresQuery = useJugadores();
  const deleteMutation = useDeleteJugador();

  const [busqueda, setBusqueda] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Jugador | null>(null);
  const [toDelete, setToDelete] = useState<Jugador | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const jugadoresFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const all = jugadoresQuery.data ?? [];
    if (q === '') return all;
    return all.filter((j) => j.nombre.toLowerCase().includes(q));
  }, [jugadoresQuery.data, busqueda]);

  function openNew(): void {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(j: Jugador): void {
    setEditing(j);
    setFormOpen(true);
  }

  function requestDelete(j: Jugador): void {
    setDeleteError(null);
    setToDelete(j);
  }

  async function confirmDelete(): Promise<void> {
    if (!toDelete) return;
    setDeleteError(null);
    try {
      await deleteMutation.mutateAsync(toDelete.id);
      setToDelete(null);
    } catch (err) {
      // Dos casos típicos, ambos vienen en castellano via dbErrors:
      //   - 42501 (RLS admin-only) → "No tenés permisos…"
      //   - P0001 (trigger anti-borrado) → "…tiene reservas o pagos
      //     asociados. Desactivalo en su lugar…"
      setDeleteError(
        err instanceof Error
          ? err.message
          : 'No pudimos eliminar el jugador. Probá de nuevo.',
      );
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Jugadores
          </h1>
          <p className="text-sm text-muted-foreground">
            Personas del club. La ficha se usa en reservas, clases y futuras
            estadísticas. Sólo el nombre es obligatorio.
          </p>
        </div>
        {canEdit && (
          <Button type="button" onClick={openNew} className="shrink-0">
            <Plus className="h-4 w-4" />
            Agregar jugador
          </Button>
        )}
      </header>

      {/* Buscador */}
      <div className="relative max-w-md">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre…"
          className="pl-9"
          aria-label="Buscar jugador por nombre"
        />
      </div>

      <JugadoresTable
        query={jugadoresQuery}
        jugadores={jugadoresFiltrados}
        busquedaActiva={busqueda.trim() !== ''}
        isAdmin={isAdmin}
        canEdit={canEdit}
        onEdit={openEdit}
        onDelete={requestDelete}
      />

      <JugadorFormDialog
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
            <DialogTitle>¿Eliminar jugador?</DialogTitle>
            <DialogDescription>
              Esta acción no se puede deshacer. El jugador
              {toDelete ? ` "${toDelete.nombre}"` : ''} se va a eliminar
              de forma permanente. Si tiene reservas o pagos asociados, no
              se puede borrar — usá "Desactivar" desde el formulario de
              edición en su lugar.
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
    </div>
  );
}

interface JugadoresTableProps {
  query: ReturnType<typeof useJugadores>;
  jugadores: Jugador[];
  busquedaActiva: boolean;
  isAdmin: boolean;
  canEdit: boolean;
  onEdit: (j: Jugador) => void;
  onDelete: (j: Jugador) => void;
}

function JugadoresTable({
  query,
  jugadores,
  busquedaActiva,
  isAdmin,
  canEdit,
  onEdit,
  onDelete,
}: JugadoresTableProps) {
  if (query.isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
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

  if (jugadores.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted-foreground">
          {busquedaActiva
            ? 'Ningún jugador coincide con la búsqueda.'
            : 'Todavía no agregaste jugadores. Cargá el primero para empezar.'}
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
            <th className="px-3 py-2 font-medium">Género</th>
            <th className="px-3 py-2 font-medium">Categoría</th>
            <th className="px-3 py-2 font-medium">Posición</th>
            <th className="px-3 py-2 font-medium">Estado</th>
            <th className="w-1 px-3 py-2 text-right font-medium">
              <span className="sr-only">Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {jugadores.map((j) => (
            <tr
              key={j.id}
              className={cn(
                'border-b border-border last:border-b-0 transition-colors',
                !j.activo && 'bg-muted/20',
              )}
            >
              <td
                className={cn(
                  'px-3 py-3 font-medium',
                  j.activo ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {j.nombre}
              </td>
              <td className="px-3 py-3 text-muted-foreground">
                {j.telefono ?? '—'}
              </td>
              <td className="max-w-[200px] px-3 py-3 text-muted-foreground">
                <span className="block truncate" title={j.email ?? undefined}>
                  {j.email ?? '—'}
                </span>
              </td>
              <td className="px-3 py-3 text-muted-foreground">
                {j.genero ? GENERO_LABEL[j.genero] : '—'}
              </td>
              <td className="px-3 py-3 text-muted-foreground">
                {j.categoria ? CATEGORIA_LABEL[j.categoria] : '—'}
              </td>
              <td className="px-3 py-3 text-muted-foreground">
                {j.posicion ? POSICION_LABEL[j.posicion] : '—'}
              </td>
              <td className="px-3 py-3">
                {j.activo ? (
                  <span className="text-foreground">Activo</span>
                ) : (
                  <span className="text-muted-foreground">Inactivo</span>
                )}
              </td>
              <td className="px-3 py-3">
                <div className="flex justify-end gap-1">
                  {canEdit && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onEdit(j)}
                      aria-label={`Editar ${j.nombre}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                  {/* Eliminar: cosmético solo admin. La seguridad real
                      la da la RLS jugadores_delete (admin-only). */}
                  {isAdmin && canEdit && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onDelete(j)}
                      aria-label={`Eliminar ${j.nombre}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
