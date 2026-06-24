import { useMemo, useState, useEffect } from 'react';
import { Pencil, Plus, Search, Trash2, CircleDollarSign } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useSession } from '@/features/auth';
import { getPermiso } from '@/lib/permisos';
import {
  useDeleteJugador,
  useJugadores,
  usePagarCuentaCorriente,
} from '@/features/reservas/hooks/useJugadores';
import type { Jugador, MedioPago } from '@/types/database';
import { JugadorFormDialog } from './JugadorFormDialog';
import {
  CATEGORIA_LABEL,
  GENERO_LABEL,
  POSICION_LABEL,
} from './jugadorSchema';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

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
  const [payingJugador, setPayingJugador] = useState<Jugador | null>(null);

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
        onPay={setPayingJugador}
      />

      <JugadorFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initialValue={editing}
      />

      <PagarDeudaDialog
        open={!!payingJugador}
        onOpenChange={(open) => !open && setPayingJugador(null)}
        jugador={payingJugador}
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
  onPay: (j: Jugador) => void;
}

function JugadoresTable({
  query,
  jugadores,
  busquedaActiva,
  isAdmin,
  canEdit,
  onEdit,
  onDelete,
  onPay,
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
            <th className="px-3 py-2 font-medium">Saldo</th>
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
                {Number((j as any).saldo) > 0 ? (
                  <span className="font-semibold text-destructive tabular-nums">
                    Debe {currencyFmt.format((j as any).saldo)}
                  </span>
                ) : Number((j as any).saldo) < 0 ? (
                  <span className="font-semibold text-green-600 dark:text-green-400 tabular-nums">
                    A favor {currencyFmt.format(Math.abs((j as any).saldo))}
                  </span>
                ) : (
                  <span className="text-muted-foreground">$0,00</span>
                )}
              </td>
              <td className="px-3 py-3">
                <div className="flex justify-end gap-1">
                  {canEdit && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onPay(j)}
                      title="Saldar / Abonar cuenta"
                      aria-label={`Saldar cuenta de ${j.nombre}`}
                      className="text-primary hover:text-primary/80"
                    >
                      <CircleDollarSign className="h-4 w-4" />
                    </Button>
                  )}
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

interface PagarDeudaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jugador: Jugador | null;
}

function PagarDeudaDialog({ open, onOpenChange, jugador }: PagarDeudaDialogProps) {
  const [monto, setMonto] = useState('');
  const [medio, setMedio] = useState<MedioPago>('efectivo');
  const [obs, setObs] = useState('');
  const [error, setError] = useState<string | null>(null);

  const pagarMutation = usePagarCuentaCorriente();

  useEffect(() => {
    if (open && jugador) {
      const currentSaldo = (jugador as any).saldo ?? 0;
      setMonto(currentSaldo > 0 ? String(currentSaldo) : '');
      setMedio('efectivo');
      setObs('');
      setError(null);
    }
  }, [open, jugador]);

  if (!jugador) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!jugador) return;
    setError(null);

    const valMonto = Number(monto);
    if (isNaN(valMonto) || valMonto <= 0) {
      setError('Ingresá un monto válido mayor a 0.');
      return;
    }

    try {
      await pagarMutation.mutateAsync({
        jugadorId: jugador.id,
        monto: valMonto,
        medioPago: medio,
        observaciones: obs.trim(),
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el abono.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Abonar Cuenta Corriente</DialogTitle>
            <DialogDescription>
              Registrá una entrega de dinero para saldar o abonar a la cuenta de <strong>{jugador.nombre}</strong>.
            </DialogDescription>
          </DialogHeader>

          {/* Saldo actual info */}
          <div className="rounded-lg bg-muted/40 p-3 text-xs flex justify-between items-center border border-border">
            <span className="text-muted-foreground">Saldo actual (deuda):</span>
            <span className={cn(
              "font-semibold tabular-nums",
              Number((jugador as any).saldo) > 0 ? "text-destructive" : "text-green-600 dark:text-green-400"
            )}>
              {currencyFmt.format((jugador as any).saldo ?? 0)}
            </span>
          </div>

          {/* Monto */}
          <div className="space-y-2">
            <Label htmlFor="pagar-monto">Monto a recibir ($)</Label>
            <Input
              id="pagar-monto"
              type="number"
              min={1}
              required
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              placeholder="1000..."
              disabled={pagarMutation.isPending}
            />
          </div>

          {/* Medio de Pago */}
          <div className="space-y-2">
            <Label htmlFor="pagar-medio">Medio de pago</Label>
            <select
              id="pagar-medio"
              value={medio}
              onChange={(e) => setMedio(e.target.value as MedioPago)}
              disabled={pagarMutation.isPending}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="mp">Mercado Pago</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="otro">Otro</option>
            </select>
          </div>

          {/* Observaciones */}
          <div className="space-y-2">
            <Label htmlFor="pagar-obs">Observaciones (opcional)</Label>
            <Input
              id="pagar-obs"
              type="text"
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder="Notas del pago..."
              disabled={pagarMutation.isPending}
            />
          </div>

          {error && (
            <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pagarMutation.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pagarMutation.isPending}>
              {pagarMutation.isPending ? 'Procesando...' : 'Confirmar abono'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
