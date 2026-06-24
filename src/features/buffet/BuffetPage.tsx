import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronLeft, Plus, Users, UtensilsCrossed } from 'lucide-react';
import { useSession } from '@/features/auth';
import { getPermiso } from '@/lib/permisos';
import { useProductosConStock } from '@/features/configuracion/hooks/useProductosConStock';
import { Catalogo } from './Catalogo';
import { CerrarVentaDialog } from './CerrarVentaDialog';
import { VentaActual, type VentaItemEnriquecido } from './VentaActual';
import {
  useMesas,
  useCrearMesa,
  useCargarConsumoMesa,
  useQuitarConsumoMesa,
} from './hooks/useMesasBuffet';
import { CerrarMesaDialog } from './CerrarMesaDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function BuffetPage() {
  const { user } = useSession();
  const canEdit = getPermiso(user, 'mostrador', 'editar');

  const productosQuery = useProductosConStock();
  const productos = useMemo(
    () => productosQuery.data ?? [],
    [productosQuery.data],
  );

  // Active view: 'mostrador' (fast counter sale) | 'mesas' (table service)
  const [activeTab, setActiveTab] = useState<'mostrador' | 'mesas'>('mostrador');

  // Mostrador Cart: Map<producto_id, cantidad>
  const [cart, setCart] = useState<Map<number, number>>(() => new Map());

  // Selected mesa for detailing
  const [selectedMesaId, setSelectedMesaId] = useState<number | null>(null);

  // Dialogs
  const [cerrarOpen, setCerrarOpen] = useState(false);
  const [cerrarMesaOpen, setCerrarMesaOpen] = useState(false);
  const [nuevaMesaOpen, setNuevaMesaOpen] = useState(false);
  const [nuevaMesaName, setNuevaMesaName] = useState('');

  // Buffet Mesa Hooks
  const mesasQuery = useMesas();
  const crearMesaMutation = useCrearMesa();
  const cargarConsumo = useCargarConsumoMesa();
  const quitarConsumo = useQuitarConsumoMesa();

  const selectedMesa = useMemo(() => {
    if (selectedMesaId === null) return null;
    return (mesasQuery.data ?? []).find((m) => m.id === selectedMesaId) ?? null;
  }, [mesasQuery.data, selectedMesaId]);

  // Clean selected mesa if it was closed
  useEffect(() => {
    if (selectedMesaId !== null && !selectedMesa) {
      setSelectedMesaId(null);
    }
  }, [selectedMesa, selectedMesaId]);

  // Banner feedback
  const [lastSale, setLastSale] = useState<{ total: number; msg?: string } | null>(null);
  useEffect(() => {
    if (lastSale === null) return;
    const id = window.setTimeout(() => setLastSale(null), 5000);
    return () => window.clearTimeout(id);
  }, [lastSale]);

  function addOneMostrador(productoId: number): void {
    setLastSale(null);
    setCart((prev) => {
      const next = new Map(prev);
      next.set(productoId, (prev.get(productoId) ?? 0) + 1);
      return next;
    });
  }

  function decrementOneMostrador(productoId: number): void {
    setCart((prev) => {
      const next = new Map(prev);
      const current = prev.get(productoId) ?? 0;
      if (current <= 1) next.delete(productoId);
      else next.set(productoId, current - 1);
      return next;
    });
  }

  function incrementOneMostrador(productoId: number): void {
    setCart((prev) => {
      const next = new Map(prev);
      next.set(productoId, (prev.get(productoId) ?? 0) + 1);
      return next;
    });
  }

  // Handle addition in active mesa
  async function addOneMesa(productoId: number): Promise<void> {
    if (!selectedMesaId) return;
    setLastSale(null);
    await cargarConsumo.mutateAsync({
      mesaId: selectedMesaId,
      productoId,
      cantidad: 1,
    });
  }

  async function decrementOneMesa(productoId: number): Promise<void> {
    if (!selectedMesaId) return;
    await quitarConsumo.mutateAsync({
      mesaId: selectedMesaId,
      productoId,
      cantidad: 1,
    });
  }

  async function incrementOneMesa(productoId: number): Promise<void> {
    if (!selectedMesaId) return;
    await cargarConsumo.mutateAsync({
      mesaId: selectedMesaId,
      productoId,
      cantidad: 1,
    });
  }

  function clearCartMostrador(): void {
    setCart(new Map());
  }

  // Enrich cart items for the counter sale
  const itemsMostrador: VentaItemEnriquecido[] = useMemo(() => {
    const result: VentaItemEnriquecido[] = [];
    for (const [id, cantidad] of cart.entries()) {
      const producto = productos.find((p) => p.id === id);
      if (!producto) continue;
      result.push({
        producto,
        cantidad,
        subtotal: producto.precio * cantidad,
      });
    }
    return result;
  }, [cart, productos]);

  const totalMostrador = useMemo(
    () => itemsMostrador.reduce((sum, i) => sum + i.subtotal, 0),
    [itemsMostrador],
  );

  // Enrich items for the selected mesa
  const itemsMesa: VentaItemEnriquecido[] = useMemo(() => {
    if (!selectedMesa) return [];
    return selectedMesa.consumos.map((c) => {
      const prodConStock = productos.find((p) => p.id === c.producto.id);
      return {
        producto: prodConStock || {
          id: c.producto.id,
          nombre: c.producto.nombre,
          precio: c.producto.precio,
          costo: c.producto.costo,
          stock_actual: 0,
          club_id: selectedMesa.club_id,
          linea: 'buffet',
          categoria: 'bebidas',
          stock_minimo: 0,
          activo: true,
          fecha_alta: new Date().toISOString(),
        },
        cantidad: c.cantidad,
        subtotal: c.producto.precio * c.cantidad,
      };
    });
  }, [selectedMesa, productos]);

  const totalMesa = useMemo(
    () => itemsMesa.reduce((sum, i) => sum + i.subtotal, 0),
    [itemsMesa],
  );

  async function handleCreateMesa(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!nuevaMesaName.trim()) return;
    try {
      const created = await crearMesaMutation.mutateAsync(nuevaMesaName);
      setNuevaMesaName('');
      setNuevaMesaOpen(false);
      setSelectedMesaId(created.id);
    } catch (err) {
      // handled by mutation state
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Buffet / Bar
          </h1>
          <p className="text-sm text-muted-foreground">
            Gestioná ventas rápidas en mostrador o consumos acumulados por mesas activas del salón.
          </p>
        </div>

        {/* Tab switcher */}
        <div className="inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground self-start sm:self-auto">
          <button
            type="button"
            onClick={() => {
              setActiveTab('mostrador');
              setSelectedMesaId(null);
            }}
            className={`inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
              activeTab === 'mostrador'
                ? 'bg-background text-foreground shadow-sm'
                : 'hover:bg-background/50 hover:text-foreground'
            }`}
          >
            Venta Directa
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('mesas')}
            className={`inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
              activeTab === 'mesas'
                ? 'bg-background text-foreground shadow-sm'
                : 'hover:bg-background/50 hover:text-foreground'
            }`}
          >
            Mesas Activas
          </button>
        </div>
      </header>

      {lastSale && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-xl border p-3 text-sm transition-all animate-in fade-in slide-in-from-top-1"
          style={{
            borderColor: 'hsl(var(--estado-pagada) / 0.3)',
            backgroundColor: 'hsl(var(--estado-pagada) / 0.08)',
          }}
        >
          <CheckCircle2
            className="h-4 w-4 shrink-0"
            style={{ color: 'hsl(var(--estado-pagada))' }}
            aria-hidden="true"
          />
          <span className="text-foreground">
            {lastSale.msg || 'Venta registrada por'}{' '}
            <span className="font-semibold tabular-nums">
              {currencyFmt.format(lastSale.total)}
            </span>
            .
          </span>
        </div>
      )}

      {productosQuery.isLoading || (activeTab === 'mesas' && mesasQuery.isLoading) ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl border border-border bg-muted/30"
            />
          ))}
        </div>
      ) : productosQuery.error ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
        >
          {productosQuery.error.message}
        </div>
      ) : (
        <>
          {activeTab === 'mostrador' && (
            <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
              <Catalogo
                productos={productos}
                cart={cart}
                onAdd={addOneMostrador}
                readOnly={!canEdit}
              />
              <VentaActual
                items={itemsMostrador}
                total={totalMostrador}
                onIncrement={incrementOneMostrador}
                onDecrement={decrementOneMostrador}
                onCerrar={() => setCerrarOpen(true)}
                readOnly={!canEdit}
              />
            </div>
          )}

          {activeTab === 'mesas' && (
            <>
              {selectedMesaId === null ? (
                /* Grid list of open tables */
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Mesas abiertas ({(mesasQuery.data ?? []).length})
                    </span>
                    {canEdit && (
                      <Button
                        type="button"
                        onClick={() => setNuevaMesaOpen(true)}
                        size="sm"
                        className="rounded-lg"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Abrir Mesa
                      </Button>
                    )}
                  </div>

                  {(mesasQuery.data ?? []).length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border p-12 text-center">
                      <UtensilsCrossed className="mx-auto h-8 w-8 text-muted-foreground/60" />
                      <h3 className="mt-4 text-sm font-semibold text-foreground">No hay mesas abiertas</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Abrí una mesa del bar/salón para empezar a cargar consumos y cobrarlos unificados al final.
                      </p>
                      {canEdit && (
                        <Button
                          type="button"
                          onClick={() => setNuevaMesaOpen(true)}
                          size="sm"
                          variant="outline"
                          className="mt-4 rounded-lg"
                        >
                          Abrir la primera mesa
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                      {(mesasQuery.data ?? []).map((m) => {
                        const mTotal = m.consumos.reduce(
                          (sum, c) => sum + c.producto.precio * c.cantidad,
                          0,
                        );
                        return (
                          <div
                            key={m.id}
                            className="flex flex-col justify-between rounded-xl border border-border bg-card p-4.5 shadow-sm transition-all hover:shadow-md"
                          >
                            <div className="space-y-1.5">
                              <h3 className="font-semibold text-foreground">{m.nombre}</h3>
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Users className="h-3.5 w-3.5 shrink-0" />
                                <span>{m.consumos.length} consumos cargados</span>
                              </div>
                            </div>
                            <div className="mt-4 flex items-center justify-between gap-2 border-t border-border/60 pt-3">
                              <span className="text-sm font-semibold text-foreground tabular-nums">
                                {currencyFmt.format(mTotal)}
                              </span>
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                onClick={() => setSelectedMesaId(m.id)}
                                className="text-xs h-8 rounded-lg"
                              >
                                Ver / Cargar
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                /* Detail of selected table */
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedMesaId(null)}
                      className="rounded-lg h-8 px-2 text-muted-foreground hover:text-foreground"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Volver a mesas
                    </Button>
                    <span className="text-sm text-muted-foreground">/</span>
                    <span className="font-semibold text-foreground">
                      Editando {selectedMesa?.nombre}
                    </span>
                  </div>

                  <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
                    <Catalogo
                      productos={productos}
                      cart={new Map(itemsMesa.map((i) => [i.producto.id, i.cantidad]))}
                      onAdd={addOneMesa}
                      readOnly={!canEdit}
                    />
                    <VentaActual
                      items={itemsMesa}
                      total={totalMesa}
                      onIncrement={incrementOneMesa}
                      onDecrement={decrementOneMesa}
                      onCerrar={() => setCerrarMesaOpen(true)}
                      readOnly={!canEdit}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Counter sale billing dialog */}
      <CerrarVentaDialog
        open={cerrarOpen}
        onOpenChange={setCerrarOpen}
        items={itemsMostrador}
        total={totalMostrador}
        onSuccess={(venta) => {
          setCerrarOpen(false);
          clearCartMostrador();
          setLastSale({ total: venta.monto_total, msg: 'Venta registrada por' });
        }}
      />

      {/* Table billing dialog */}
      <CerrarMesaDialog
        open={cerrarMesaOpen}
        onOpenChange={setCerrarMesaOpen}
        mesa={selectedMesa}
        onSuccess={(venta) => {
          setCerrarMesaOpen(false);
          setSelectedMesaId(null);
          setLastSale({ total: venta.monto_total, msg: `${selectedMesa?.nombre} cobrada con éxito por` });
        }}
      />

      {/* Open table Dialog */}
      <Dialog open={nuevaMesaOpen} onOpenChange={setNuevaMesaOpen}>
        <DialogContent className="max-w-sm">
          <form onSubmit={handleCreateMesa} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Abrir mesa del bar</DialogTitle>
              <DialogDescription>
                Ingresá un nombre identificador (ej. "Mesa 5", "Barra", "Santiago").
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label htmlFor="mesa-nombre-input">Nombre / Identificador</Label>
              <Input
                id="mesa-nombre-input"
                type="text"
                required
                maxLength={40}
                value={nuevaMesaName}
                onChange={(e) => setNuevaMesaName(e.target.value)}
                placeholder="Mesa 10…"
                disabled={crearMesaMutation.isPending}
              />
              {crearMesaMutation.error && (
                <p className="text-xs text-destructive">
                  {crearMesaMutation.error.message}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setNuevaMesaOpen(false)}
                disabled={crearMesaMutation.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={crearMesaMutation.isPending}>
                {crearMesaMutation.isPending ? 'Abriendo...' : 'Abrir Mesa'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
