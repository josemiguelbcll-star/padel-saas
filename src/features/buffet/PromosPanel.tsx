import { type FormEvent, useMemo, useState } from 'react';
import { Check, Pencil, Plus, Search, Tag, ToggleLeft, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { ProductoConStock, PromoBuffet } from '@/types/database';
import {
  useCambiarEstadoPromoBuffet,
  useGuardarPromoBuffet,
  usePromosBuffet,
  type PromoBuffetItemInput,
} from './hooks/usePromosBuffet';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

interface PromosPanelProps {
  productos: ProductoConStock[];
  canEdit: boolean;
}

export function PromosPanel({ productos, canEdit }: PromosPanelProps) {
  const promosQuery = usePromosBuffet();
  const guardarPromo = useGuardarPromoBuffet();
  const cambiarEstadoPromo = useCambiarEstadoPromoBuffet();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPromo, setEditingPromo] = useState<PromoBuffet | null>(null);
  const [nombre, setNombre] = useState('');
  const [busquedaProducto, setBusquedaProducto] = useState('');
  const [cantidades, setCantidades] = useState<Map<number, number>>(() => new Map());
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const productosActivos = useMemo(
    () => productos.filter((producto) => producto.activo),
    [productos],
  );
  const productosFiltrados = useMemo(() => {
    const termino = busquedaProducto.trim().toLocaleLowerCase();
    if (termino === '') return productosActivos;
    return productosActivos.filter((producto) =>
      producto.nombre.toLocaleLowerCase().includes(termino),
    );
  }, [busquedaProducto, productosActivos]);
  const productosSeleccionados = useMemo(
    () => [...cantidades.entries()].map(([productoId, cantidad]) => ({
      producto: productos.find((item) => item.id === productoId),
      productoId,
      cantidad,
    })),
    [cantidades, productos],
  );
  const totalSeleccionado = productosSeleccionados.reduce(
    (total, item) => total + (item.producto?.precio ?? 0) * item.cantidad,
    0,
  );

  function openNew(): void {
    setEditingPromo(null);
    setNombre('');
    setBusquedaProducto('');
    setCantidades(new Map());
    setFormError(null);
    setActionError(null);
    setDialogOpen(true);
  }

  function openEdit(promo: PromoBuffet): void {
    setEditingPromo(promo);
    setNombre(promo.nombre);
    setBusquedaProducto('');
    setCantidades(new Map(promo.items.map((item) => [item.producto_id, item.cantidad])));
    setFormError(null);
    setActionError(null);
    setDialogOpen(true);
  }

  function toggleProducto(productoId: number): void {
    setCantidades((actuales) => {
      const nuevas = new Map(actuales);
      if (nuevas.has(productoId)) nuevas.delete(productoId);
      else nuevas.set(productoId, 1);
      return nuevas;
    });
  }

  function cambiarCantidad(productoId: number, cantidad: number): void {
    if (!Number.isInteger(cantidad) || cantidad < 1) return;
    setCantidades((actuales) => new Map(actuales).set(productoId, cantidad));
  }

  async function handleSave(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    const items: PromoBuffetItemInput[] = [...cantidades.entries()].map(
      ([producto_id, cantidad]) => ({ producto_id, cantidad }),
    );

    try {
      await guardarPromo.mutateAsync({
        promo_id: editingPromo?.id ?? null,
        nombre,
        items,
      });
      setDialogOpen(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'No pudimos guardar la promo.');
    }
  }

  async function handleTogglePromo(promo: PromoBuffet): Promise<void> {
    if (promo.activo && !window.confirm(`¿Desactivar la promo "${promo.nombre}"?`)) return;
    setActionError(null);
    try {
      await cambiarEstadoPromo.mutateAsync({ promoId: promo.id, activo: !promo.activo });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No pudimos cambiar el estado de la promo.');
    }
  }

  if (promosQuery.isLoading) {
    return <div className="h-24 animate-pulse rounded-xl border border-border bg-muted/30" aria-busy="true" />;
  }

  if (promosQuery.error) {
    return <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{promosQuery.error.message}</p>;
  }

  const promos = promosQuery.data ?? [];

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Promos predefinidas</h2>
          <p className="text-sm text-muted-foreground">
            Agrupá productos para agregarlos juntos a un turno o a una venta directa. Se cobran al precio actual de cada producto.
          </p>
        </div>
        {canEdit && (
          <Button type="button" onClick={openNew}>
            <Plus className="h-4 w-4" />
            Nueva promo
          </Button>
        )}
      </header>

      {actionError && <p className="text-sm text-destructive" role="alert">{actionError}</p>}

      {promos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <Tag className="mx-auto h-8 w-8 text-muted-foreground/60" />
          <p className="mt-3 text-sm font-medium text-foreground">Todavía no hay promos</p>
          <p className="mt-1 text-xs text-muted-foreground">Creá un combo con uno o varios productos del catálogo.</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {promos.map((promo) => (
            <article key={promo.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-foreground">{promo.nombre}</h3>
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                      promo.activo ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground',
                    )}>
                      {promo.activo ? 'Activa' : 'Inactiva'}
                    </span>
                  </div>
                  <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                    {promo.items.map((item) => {
                      const producto = productos.find((candidate) => candidate.id === item.producto_id);
                      return (
                        <li key={item.id} className="flex justify-between gap-3">
                          <span>{item.cantidad} × {producto?.nombre ?? 'Producto no disponible'}</span>
                          {producto && (
                            <span className="shrink-0 tabular-nums">
                              {new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(producto.precio * item.cantidad)}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
                {canEdit && (
                  <div className="flex shrink-0 gap-1">
                    <Button type="button" variant="ghost" size="icon" aria-label={`Editar ${promo.nombre}`} onClick={() => openEdit(promo)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`${promo.activo ? 'Desactivar' : 'Activar'} ${promo.nombre}`}
                      disabled={cambiarEstadoPromo.isPending}
                      onClick={() => void handleTogglePromo(promo)}
                    >
                      {promo.activo
                        ? <ToggleLeft className="h-4 w-4" />
                        : <Check className="h-4 w-4" />}
                    </Button>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <form onSubmit={(event) => void handleSave(event)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{editingPromo ? 'Editar promo' : 'Crear promo'}</DialogTitle>
              <DialogDescription>
                Elegí productos activos y las cantidades incluidas. El combo no aplica descuentos.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label htmlFor="promo-buffet-nombre">Nombre</Label>
              <Input
                id="promo-buffet-nombre"
                required
                maxLength={120}
                value={nombre}
                onChange={(event) => setNombre(event.target.value)}
                placeholder="Ej. Bebidas para el partido"
                disabled={guardarPromo.isPending}
              />
            </div>

            <section
              className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3"
              aria-label="Vista previa de la promo"
              aria-live="polite"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground">
                  Vista previa · {cantidades.size} {cantidades.size === 1 ? 'producto' : 'productos'}
                </h3>
                <span className="text-sm font-bold tabular-nums text-foreground">
                  {currencyFmt.format(totalSeleccionado)}
                </span>
              </div>
              {productosSeleccionados.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Elegí uno o más productos para ver cómo queda la promo.
                </p>
              ) : (
                <ul className="max-h-28 space-y-1 overflow-y-auto text-xs">
                  {productosSeleccionados.map(({ producto, productoId, cantidad }) => (
                    <li key={productoId} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {cantidad} × {producto?.nombre ?? 'Producto no disponible'}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {currencyFmt.format((producto?.precio ?? 0) * cantidad)}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleProducto(productoId)}
                        disabled={guardarPromo.isPending}
                        aria-label={`Quitar ${producto?.nombre ?? 'producto'} de la promo`}
                        className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Productos incluidos</legend>
              {productosActivos.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay productos activos para agregar a la promo.</p>
              ) : (
                <>
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <Input
                      type="search"
                      value={busquedaProducto}
                      onChange={(event) => setBusquedaProducto(event.target.value)}
                      placeholder="Buscar producto..."
                      aria-label="Buscar productos para la promo"
                      className="pl-9"
                      disabled={guardarPromo.isPending}
                    />
                  </div>
                  <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                  {productosFiltrados.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      No hay productos que coincidan con la búsqueda.
                    </p>
                  ) : productosFiltrados.map((producto) => {
                    const cantidad = cantidades.get(producto.id);
                    const seleccionado = cantidad !== undefined;
                    return (
                      <div key={producto.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50">
                        <input
                          id={`promo-producto-${producto.id}`}
                          type="checkbox"
                          checked={seleccionado}
                          onChange={() => toggleProducto(producto.id)}
                          disabled={guardarPromo.isPending}
                          className="h-4 w-4 accent-primary"
                        />
                        <label htmlFor={`promo-producto-${producto.id}`} className="min-w-0 flex-1 cursor-pointer">
                          <span className="block truncate text-sm font-medium">{producto.nombre}</span>
                          <span className="text-xs text-muted-foreground">
                            {producto.linea === 'shop' ? 'Shop' : 'Buffet'} · {new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(producto.precio)}
                          </span>
                        </label>
                        {seleccionado && (
                          <div className="flex items-center gap-2">
                            <Label htmlFor={`promo-cantidad-${producto.id}`} className="text-xs text-muted-foreground">Cant.</Label>
                            <Input
                              id={`promo-cantidad-${producto.id}`}
                              type="number"
                              min={1}
                              step={1}
                              className="h-8 w-20"
                              value={cantidad}
                              onChange={(event) => cambiarCantidad(producto.id, Number(event.target.value))}
                              disabled={guardarPromo.isPending}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                  </div>
                </>
              )}
            </fieldset>

            {formError && <p className="text-sm text-destructive" role="alert">{formError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={guardarPromo.isPending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={guardarPromo.isPending || cantidades.size === 0}>
                {guardarPromo.isPending ? 'Guardando...' : 'Guardar promo'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
