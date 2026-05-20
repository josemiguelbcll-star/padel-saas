import { useState } from 'react';
import {
  AlertTriangle,
  PackagePlus,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
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
import { useDeleteProducto } from '@/features/configuracion/hooks/useProductos';
import { useProductosConStock } from '@/features/configuracion/hooks/useProductosConStock';
import type { Producto, ProductoConStock } from '@/types/database';
import { CargarStockDialog } from './CargarStockDialog';
import { ProductoFormDialog } from './ProductoFormDialog';
import { CATEGORIA_LABEL } from './productoSchema';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function ProductosPage() {
  const { user } = useSession();
  const isAdmin = user?.rol === 'admin';

  const productosQuery = useProductosConStock();
  const deleteMutation = useDeleteProducto();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Producto | null>(null);
  const [cargarOpen, setCargarOpen] = useState(false);
  const [cargarTarget, setCargarTarget] = useState<ProductoConStock | null>(
    null,
  );
  const [toDelete, setToDelete] = useState<ProductoConStock | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function openNew(): void {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(p: ProductoConStock): void {
    // El form sólo necesita Producto puro (sin stock_actual). Extraemos.
    const { stock_actual: _ignore, ...puro } = p;
    setEditing(puro);
    setFormOpen(true);
  }

  function openCargar(p: ProductoConStock): void {
    setCargarTarget(p);
    setCargarOpen(true);
  }

  function requestDelete(p: ProductoConStock): void {
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
      // Si tiene movimientos, el trigger devuelve un mensaje accionable
      // ("Desactivalo en su lugar..."). Lo mostramos tal cual.
      setDeleteError(
        err instanceof Error
          ? err.message
          : 'No pudimos eliminar el producto. Probá de nuevo.',
      );
    }
  }

  return (
    <section className="space-y-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Productos
          </h2>
          <p className="text-sm text-muted-foreground">
            Catálogo del buffet. El stock se carga via "Cargar stock" por
            producto; cada carga queda registrada como movimiento de inventario.
          </p>
        </div>
        {isAdmin && (
          <Button type="button" onClick={openNew} className="shrink-0">
            <Plus className="h-4 w-4" />
            Agregar producto
          </Button>
        )}
      </header>

      <ProductosTable
        query={productosQuery}
        isAdmin={isAdmin}
        onEdit={openEdit}
        onCargarStock={openCargar}
        onDelete={requestDelete}
      />

      <ProductoFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initialValue={editing}
      />

      <CargarStockDialog
        open={cargarOpen}
        onOpenChange={(open) => {
          setCargarOpen(open);
          if (!open) setCargarTarget(null);
        }}
        producto={cargarTarget}
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
            <DialogTitle>¿Eliminar producto?</DialogTitle>
            <DialogDescription>
              Esta acción no se puede deshacer. El producto
              {toDelete ? ` "${toDelete.nombre}"` : ''} se va a eliminar de
              forma permanente. Si tiene movimientos de stock (compras o
              ventas), no se puede borrar — usá "Desactivar" desde el
              formulario de edición en su lugar.
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

interface ProductosTableProps {
  query: ReturnType<typeof useProductosConStock>;
  isAdmin: boolean;
  onEdit: (p: ProductoConStock) => void;
  onCargarStock: (p: ProductoConStock) => void;
  onDelete: (p: ProductoConStock) => void;
}

function ProductosTable({
  query,
  isAdmin,
  onEdit,
  onCargarStock,
  onDelete,
}: ProductosTableProps) {
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

  const productos = query.data ?? [];

  if (productos.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted-foreground">
          {isAdmin
            ? 'Todavía no agregaste productos. Cargá el primero para empezar a vender en el buffet.'
            : 'El administrador todavía no agregó productos al catálogo.'}
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
            <th className="px-3 py-2 font-medium">Categoría</th>
            <th className="px-3 py-2 text-right font-medium">Precio</th>
            <th className="px-3 py-2 text-right font-medium">Costo</th>
            <th className="px-3 py-2 text-right font-medium">Margen</th>
            <th className="px-3 py-2 text-right font-medium">Stock</th>
            <th className="px-3 py-2 text-right font-medium">Mínimo</th>
            <th className="px-3 py-2 font-medium">Estado</th>
            {isAdmin && (
              <th className="w-1 px-3 py-2 text-right font-medium">
                <span className="sr-only">Acciones</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {productos.map((p) => (
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
                {CATEGORIA_LABEL[p.categoria]}
              </td>
              <td className="px-3 py-3 text-right tabular-nums text-foreground">
                {currencyFmt.format(p.precio)}
              </td>
              <td className="px-3 py-3 text-right">
                <CostoCell producto={p} />
              </td>
              <td className="px-3 py-3 text-right">
                <MargenCell producto={p} />
              </td>
              <td className="px-3 py-3 text-right">
                <StockCell producto={p} />
              </td>
              <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                {p.stock_minimo}
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
                      onClick={() => onCargarStock(p)}
                      aria-label={`Cargar stock de ${p.nombre}`}
                      title="Cargar stock"
                    >
                      <PackagePlus className="h-4 w-4" />
                    </Button>
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

function CostoCell({ producto }: { producto: ProductoConStock }) {
  // NULL = no cargado → "—" muted. Es importante distinguir esto de
  // "cuesta cero real": un 0 hardcodeado sería una mentira contable.
  if (producto.costo === null) {
    return <span className="tabular-nums text-muted-foreground">—</span>;
  }
  return (
    <span className="tabular-nums text-foreground">
      {currencyFmt.format(producto.costo)}
    </span>
  );
}

function MargenCell({ producto }: { producto: ProductoConStock }) {
  // Sin costo cargado → margen no calculable. No mostramos un margen falso.
  if (producto.costo === null) {
    return <span className="tabular-nums text-muted-foreground">—</span>;
  }
  const margen = producto.precio - producto.costo;
  // Margen negativo: rojo. El club puede tener motivos para vender por
  // debajo del costo (promoción, liquidación), no bloqueamos; solo
  // marcamos visualmente para que sea obvio en la tabla.
  return (
    <span
      className={cn(
        'tabular-nums',
        margen < 0 ? 'text-destructive' : 'text-foreground',
      )}
    >
      {currencyFmt.format(margen)}
    </span>
  );
}

function StockCell({ producto }: { producto: ProductoConStock }) {
  // Sin stock: gris, sin ícono. Cero stock no es un "warning", es un
  // hecho operativo (el producto no se puede vender hasta que se cargue).
  if (producto.stock_actual <= 0) {
    return (
      <span className="tabular-nums text-muted-foreground">
        {producto.stock_actual}
      </span>
    );
  }

  // Stock bajo: ámbar + ícono. Sólo cuando hay un mínimo configurado y
  // el stock actual está por debajo.
  if (producto.stock_minimo > 0 && producto.stock_actual < producto.stock_minimo) {
    return (
      <span className="inline-flex items-center justify-end gap-1 tabular-nums text-amber-600 dark:text-amber-500">
        <AlertTriangle className="h-3.5 w-3.5" aria-label="Stock bajo" />
        {producto.stock_actual}
      </span>
    );
  }

  return (
    <span className="tabular-nums text-foreground">
      {producto.stock_actual}
    </span>
  );
}
