import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Pencil, Plus, Trash2 } from 'lucide-react';
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
import { useCuentas } from '@/features/configuracion/hooks/useCuentas';
import {
  PRODUCTOS_CON_STOCK_QUERY_KEY,
  useProductosConStock,
} from '@/features/configuracion/hooks/useProductosConStock';
import { useSession } from '@/features/auth';
import { useJugadores } from '@/features/reservas/hooks/useJugadores';
import { mapPostgrestError } from '@/lib/dbErrors';
import { supabase } from '@/lib/supabase';
import type {
  MedioPago,
  Venta,
  VentaItem,
} from '@/types/database';

type MedioPagoVenta = Exclude<MedioPago, 'mixto'>;

interface VentaPago {
  id: number;
  venta_id: number;
  monto: number;
  medio_pago: string;
  cuenta_id: number | null;
  jugador_id: number | null;
}

interface VentaConDetalle extends Venta {
  items: VentaItem[];
  pagos: VentaPago[];
}

interface ItemDraft {
  key: string;
  productoId: number;
  cantidad: string;
  precioOriginal: number;
}

interface PagoDraft {
  key: string;
  medioPago: MedioPagoVenta;
  monto: string;
  cuentaId: number | null;
  jugadorId: number | null;
}

const MEDIOS_PAGO: readonly MedioPagoVenta[] = [
  'efectivo',
  'transferencia',
  'mp',
  'tarjeta',
  'cuenta_corriente',
  'otro',
];

const MEDIO_LABEL: Record<MedioPagoVenta, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  mp: 'Mercado Pago',
  tarjeta: 'Tarjeta',
  cuenta_corriente: 'Cuenta corriente',
  otro: 'Otro',
};

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function normalizarMedioPago(medio: string): MedioPagoVenta {
  if (medio === 'mercadopago' || medio === 'mercado_pago') return 'mp';
  if (medio === 'deposito') return 'transferencia';
  return MEDIOS_PAGO.includes(medio as MedioPagoVenta)
    ? (medio as MedioPagoVenta)
    : 'otro';
}

function nuevaClave(): string {
  return `${Date.now()}-${Math.random()}`;
}

function invalidarDatosDeVentas(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: ['buffet', 'ventas'] });
  void queryClient.invalidateQueries({ queryKey: PRODUCTOS_CON_STOCK_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: ['caja'] });
  void queryClient.invalidateQueries({ queryKey: ['caja-abierta-resumen'] });
  void queryClient.invalidateQueries({ queryKey: ['caja-movimientos'] });
  void queryClient.invalidateQueries({ queryKey: ['movimientos_cuentas'] });
  void queryClient.invalidateQueries({ queryKey: ['flujo-caja'] });
  void queryClient.invalidateQueries({ queryKey: ['ingresos_por_medio'] });
  void queryClient.invalidateQueries({ queryKey: ['resumen_financiero'] });
  void queryClient.invalidateQueries({ queryKey: ['inventario'] });
}

export function HistorialVentas() {
  const { club } = useSession();
  const queryClient = useQueryClient();
  const productosQuery = useProductosConStock();
  const cuentasQuery = useCuentas();
  const jugadoresQuery = useJugadores();
  const productos = useMemo(() => productosQuery.data ?? [], [productosQuery.data]);
  const cuentasActivas = (cuentasQuery.data ?? []).filter((cuenta) => cuenta.activa);
  const jugadores = jugadoresQuery.data ?? [];

  const ventasQuery = useQuery<VentaConDetalle[], Error>({
    queryKey: ['buffet', 'ventas', club?.id],
    enabled: Boolean(club?.id),
    queryFn: async () => {
      if (!club) throw new Error('No pudimos identificar tu club.');
      const { data: ventasData, error: ventasError } = await supabase
        .from('ventas')
        .select('*')
        .eq('club_id', club.id)
        .order('fecha_hora', { ascending: false })
        .limit(100);
      if (ventasError) throw new Error(mapPostgrestError(ventasError));

      const ventas = (ventasData ?? []) as unknown as VentaConDetalle[];
      if (ventas.length === 0) return [];

      const ventaIds = ventas.map((venta) => venta.id);
      const [itemsResult, pagosResult] = await Promise.all([
        supabase.from('venta_items').select('*').in('venta_id', ventaIds),
        supabase.from('venta_pagos').select('*').in('venta_id', ventaIds),
      ]);
      if (itemsResult.error) throw new Error(mapPostgrestError(itemsResult.error));
      if (pagosResult.error) throw new Error(mapPostgrestError(pagosResult.error));

      const items = (itemsResult.data ?? []) as unknown as VentaItem[];
      const pagos = (pagosResult.data ?? []) as unknown as VentaPago[];
      return ventas.map((venta) => ({
        ...venta,
        activa: venta.activa !== false,
        items: items.filter((item) => item.venta_id === venta.id),
        pagos: pagos.filter((pago) => pago.venta_id === venta.id),
      }));
    },
  });

  const [ventaAEditar, setVentaAEditar] = useState<VentaConDetalle | null>(null);
  const [itemsDraft, setItemsDraft] = useState<ItemDraft[]>([]);
  const [pagosDraft, setPagosDraft] = useState<PagoDraft[]>([]);
  const [productoAAgregar, setProductoAAgregar] = useState('');
  const [motivo, setMotivo] = useState('');
  const [ventaAAnular, setVentaAAnular] = useState<VentaConDetalle | null>(null);
  const [motivoAnulacion, setMotivoAnulacion] = useState('');

  const anularMutation = useMutation({
    mutationFn: async (input: { ventaId: number; motivo: string }) => {
      const { error } = await supabase.rpc('fn_anular_venta', {
        p_venta_id: input.ventaId,
        p_motivo: input.motivo,
      });
      if (error) throw new Error(mapPostgrestError(error));
    },
    onSuccess: () => {
      invalidarDatosDeVentas(queryClient);
      setVentaAAnular(null);
      setMotivoAnulacion('');
    },
  });

  const corregirMutation = useMutation({
    mutationFn: async () => {
      if (!ventaAEditar) throw new Error('Seleccioná una venta para corregir.');
      if (!motivo.trim()) throw new Error('Indicá el motivo de la corrección.');
      if (itemsDraft.length === 0) throw new Error('La venta debe tener al menos un producto.');
      if (pagosDraft.length === 0) throw new Error('La venta debe tener al menos un pago.');

      const items = itemsDraft.map((item) => {
        const cantidad = Number(item.cantidad);
        const producto = productos.find((candidate) => candidate.id === item.productoId);
        const productoOriginal = ventaAEditar.items.some(
          (ventaItem) => ventaItem.producto_id === item.productoId,
        );
        if (
          !producto ||
          (!producto.activo && !productoOriginal) ||
          !Number.isInteger(cantidad) ||
          cantidad <= 0
        ) {
          throw new Error('Revisá los productos y cantidades de la venta.');
        }
        return { producto_id: item.productoId, cantidad };
      });
      const pagos = pagosDraft.map((pago) => {
        const monto = Number(pago.monto);
        if (!Number.isFinite(monto) || monto <= 0) {
          throw new Error('Cada pago debe tener un monto mayor a cero.');
        }
        if (pago.medioPago === 'cuenta_corriente' && pago.jugadorId === null) {
          throw new Error('Elegí el jugador de cada pago a cuenta corriente.');
        }
        return {
          medio_pago: pago.medioPago,
          monto,
          cuenta_id: pago.cuentaId,
          jugador_id: pago.jugadorId,
        };
      });
      const total = itemsDraft.reduce((sum, item) => {
        return sum + item.precioOriginal * Number(item.cantidad);
      }, 0);
      const totalPagos = pagos.reduce((sum, pago) => sum + pago.monto, 0);
      if (Math.round(total * 100) !== Math.round(totalPagos * 100)) {
        throw new Error('La suma de los pagos debe coincidir con el total de la venta.');
      }
      const primerPago = pagos[0];
      if (!primerPago) throw new Error('La venta debe tener al menos un pago.');

      const { error } = await supabase.rpc('fn_corregir_venta', {
        p_venta_id: ventaAEditar.id,
        p_motivo: motivo.trim(),
        p_items: items,
        p_medio_pago: pagos.length > 1 ? 'mixto' : primerPago.medio_pago,
        p_observaciones: ventaAEditar.observaciones,
        p_cuenta_id: pagos.length === 1 ? primerPago.cuenta_id : null,
        p_jugador_id: ventaAEditar.jugador_id,
        p_pagos: pagos,
      });
      if (error) throw new Error(mapPostgrestError(error));
    },
    onSuccess: () => {
      invalidarDatosDeVentas(queryClient);
      setVentaAEditar(null);
      setMotivo('');
    },
  });

  const totalVentaDraft = useMemo(
    () =>
      itemsDraft.reduce((sum, item) => {
        const cantidad = Number(item.cantidad);
        return sum + item.precioOriginal * (Number.isFinite(cantidad) ? cantidad : 0);
      }, 0),
    [itemsDraft],
  );
  const totalPagosDraft = useMemo(
    () => pagosDraft.reduce((sum, pago) => sum + (Number(pago.monto) || 0), 0),
    [pagosDraft],
  );

  function abrirEdicion(venta: VentaConDetalle): void {
    setVentaAEditar(venta);
    setMotivo('');
    setItemsDraft(
      venta.items.map((item) => ({
        key: nuevaClave(),
        productoId: item.producto_id,
        cantidad: String(item.cantidad),
        precioOriginal: Number(item.precio_unitario),
      })),
    );
    setPagosDraft(
      venta.pagos.map((pago) => ({
        key: nuevaClave(),
        medioPago: normalizarMedioPago(pago.medio_pago),
        monto: String(Number(pago.monto)),
        cuentaId: pago.cuenta_id,
        jugadorId: pago.jugador_id ?? venta.jugador_id,
      })),
    );
  }

  function actualizarItem(key: string, changes: Partial<ItemDraft>): void {
    setItemsDraft((current) =>
      current.map((item) => (item.key === key ? { ...item, ...changes } : item)),
    );
  }

  function actualizarPago(key: string, changes: Partial<PagoDraft>): void {
    setPagosDraft((current) =>
      current.map((pago) => (pago.key === key ? { ...pago, ...changes } : pago)),
    );
  }

  function agregarProducto(): void {
    const productoId = Number(productoAAgregar);
    const producto = productos.find((candidate) => candidate.id === productoId && candidate.activo);
    if (!producto) return;
    const precioOriginal = ventaAEditar?.items.find((item) => item.producto_id === productoId)?.precio_unitario;
    setItemsDraft((current) => [
      ...current,
      {
        key: nuevaClave(),
        productoId,
        cantidad: '1',
        precioOriginal: Number(precioOriginal ?? producto.precio),
      },
    ]);
    setProductoAAgregar('');
  }

  if (ventasQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando historial de ventas...</p>;
  }

  if (ventasQuery.error) {
    return (
      <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
        No pudimos cargar el historial: {ventasQuery.error.message}
      </p>
    );
  }

  const ventas = ventasQuery.data ?? [];

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Historial de ventas</h2>
        <p className="text-sm text-muted-foreground">
          Podés corregir o anular ventas recientes. La operación original queda en el historial.
        </p>
      </div>

      {ventas.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Todavía no hay ventas registradas.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Venta</th>
                <th className="px-3 py-2">Productos</th>
                <th className="px-3 py-2">Pagos</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {ventas.map((venta) => (
                <tr key={venta.id} className={!venta.activa ? 'text-muted-foreground' : undefined}>
                  <td className="whitespace-nowrap px-3 py-3">
                    {new Date(venta.fecha_hora).toLocaleString('es-AR')}
                  </td>
                  <td className="px-3 py-3">#{venta.id}</td>
                  <td className="max-w-[260px] px-3 py-3">
                    {venta.items.map((item) => `${item.cantidad} × ${item.producto_nombre}`).join(', ')}
                  </td>
                  <td className="px-3 py-3">
                    {venta.pagos.map((pago) => {
                      const cuenta = cuentasActivas.find((candidate) => candidate.id === pago.cuenta_id);
                      const medio = MEDIO_LABEL[normalizarMedioPago(pago.medio_pago)];
                      return cuenta ? `${medio} · ${cuenta.nombre}` : medio;
                    }).join(', ')}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                    {currencyFmt.format(Number(venta.monto_total))}
                  </td>
                  <td className="px-3 py-3">
                    {venta.activa ? 'Activa' : 'Anulada'}
                  </td>
                  <td className="px-3 py-3">
                    {venta.activa && (
                      <div className="flex justify-end gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => abrirEdicion(venta)}>
                          <Pencil className="mr-1 h-3.5 w-3.5" />
                          Corregir
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            setVentaAAnular(venta);
                            setMotivoAnulacion('');
                          }}
                        >
                          <Ban className="mr-1 h-3.5 w-3.5" />
                          Anular
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={ventaAEditar !== null}
        onOpenChange={(open) => {
          if (!open) setVentaAEditar(null);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Corregir venta #{ventaAEditar?.id}</DialogTitle>
            <DialogDescription>
              Se anulará la venta original y se registrará una nueva con estos productos y pagos.
              Las líneas originales conservan su precio histórico; los productos nuevos usan el precio actual.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {productosQuery.error && (
              <p role="alert" className="text-sm text-destructive">
                No pudimos cargar los productos: {productosQuery.error.message}
              </p>
            )}
            {cuentasQuery.error && (
              <p role="alert" className="text-sm text-destructive">
                No pudimos cargar las cuentas: {cuentasQuery.error.message}
              </p>
            )}

            <div className="space-y-2">
              <Label>Productos</Label>
              {itemsDraft.map((item) => {
                const producto = productos.find((candidate) => candidate.id === item.productoId);
                return (
                  <div key={item.key} className="grid gap-2 sm:grid-cols-[1fr_100px_130px_auto]">
                    <select
                      aria-label="Producto de la línea"
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                      value={item.productoId}
                      onChange={(event) => {
                        const nextId = Number(event.target.value);
                        const nextProduct = productos.find((candidate) => candidate.id === nextId);
                        const precioOriginal = ventaAEditar?.items.find(
                          (ventaItem) => ventaItem.producto_id === nextId,
                        )?.precio_unitario;
                        actualizarItem(item.key, {
                          productoId: nextId,
                          precioOriginal: Number(precioOriginal ?? nextProduct?.precio ?? item.precioOriginal),
                        });
                      }}
                    >
                      {productos.map((candidate) => (
                        <option key={candidate.id} value={candidate.id} disabled={!candidate.activo}>
                          {candidate.nombre}{!candidate.activo ? ' (inactivo)' : ''}
                        </option>
                      ))}
                    </select>
                    <Input
                      aria-label={`Cantidad de ${producto?.nombre ?? 'producto'}`}
                      type="number"
                      min={1}
                      step={1}
                      value={item.cantidad}
                      onChange={(event) => actualizarItem(item.key, { cantidad: event.target.value })}
                    />
                    <div className="flex items-center justify-end text-sm tabular-nums">
                      {currencyFmt.format(
                        item.precioOriginal * (Number(item.cantidad) || 0),
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Quitar producto"
                      onClick={() => setItemsDraft((current) => current.filter((row) => row.key !== item.key))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}

              <div className="flex flex-wrap gap-2">
                <select
                  aria-label="Agregar producto"
                  className="h-9 min-w-[220px] flex-1 rounded-md border border-input bg-background px-3 text-sm"
                  value={productoAAgregar}
                  onChange={(event) => setProductoAAgregar(event.target.value)}
                >
                  <option value="">Agregar producto...</option>
                  {productos.filter((producto) => producto.activo).map((producto) => (
                    <option key={producto.id} value={producto.id}>{producto.nombre}</option>
                  ))}
                </select>
                <Button type="button" variant="outline" onClick={agregarProducto} disabled={!productoAAgregar}>
                  <Plus className="mr-1 h-4 w-4" />
                  Agregar
                </Button>
              </div>
              <p className="text-right text-sm font-semibold tabular-nums">
                Total: {currencyFmt.format(totalVentaDraft)}
              </p>
            </div>

            <div className="space-y-2">
              <Label>Pagos y destino</Label>
              {pagosDraft.map((pago) => (
                <div key={pago.key} className="grid gap-2 sm:grid-cols-[1fr_130px_1fr_auto]">
                  <select
                    aria-label="Medio de pago"
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    value={pago.medioPago}
                    onChange={(event) =>
                      actualizarPago(pago.key, {
                        medioPago: event.target.value as MedioPagoVenta,
                        cuentaId: event.target.value === 'cuenta_corriente' ? null : pago.cuentaId,
                        jugadorId: event.target.value === 'cuenta_corriente'
                          ? pago.jugadorId ?? ventaAEditar?.jugador_id ?? null
                          : null,
                      })
                    }
                  >
                    {MEDIOS_PAGO.map((medio) => (
                      <option key={medio} value={medio}>{MEDIO_LABEL[medio]}</option>
                    ))}
                  </select>
                  <Input
                    aria-label="Monto del pago"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={pago.monto}
                    onChange={(event) => actualizarPago(pago.key, { monto: event.target.value })}
                  />
                  <select
                    aria-label="Cuenta de destino"
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    value={pago.cuentaId ?? ''}
                    disabled={pago.medioPago === 'cuenta_corriente'}
                    onChange={(event) =>
                      actualizarPago(pago.key, {
                        cuentaId: event.target.value === '' ? null : Number(event.target.value),
                      })
                    }
                  >
                    <option value="">Cuenta predeterminada</option>
                    {cuentasActivas.map((cuenta) => (
                      <option key={cuenta.id} value={cuenta.id}>{cuenta.nombre}</option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Quitar pago"
                    disabled={pagosDraft.length <= 1}
                    onClick={() => setPagosDraft((current) => current.filter((row) => row.key !== pago.key))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  {pago.medioPago === 'cuenta_corriente' && (
                    <select
                      aria-label="Jugador de cuenta corriente"
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm sm:col-span-4"
                      value={pago.jugadorId ?? ''}
                      onChange={(event) =>
                        actualizarPago(pago.key, {
                          jugadorId: event.target.value === '' ? null : Number(event.target.value),
                        })
                      }
                    >
                      <option value="">Elegí el jugador de la cuenta corriente</option>
                      {jugadores.map((jugador) => (
                        <option key={jugador.id} value={jugador.id}>{jugador.nombre}</option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setPagosDraft((current) => [
                    ...current,
                    {
                      key: nuevaClave(),
                      medioPago: 'efectivo',
                      monto: '0',
                      cuentaId: null,
                      jugadorId: null,
                    },
                  ])
                }
              >
                <Plus className="mr-1 h-4 w-4" />
                Agregar pago
              </Button>
              <p className="text-right text-xs text-muted-foreground tabular-nums">
                Pagos: {currencyFmt.format(totalPagosDraft)}
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="venta-correccion-motivo">Motivo de la corrección</Label>
              <Input
                id="venta-correccion-motivo"
                value={motivo}
                onChange={(event) => setMotivo(event.target.value)}
                maxLength={500}
                placeholder="Ej.: se registró transferencia en lugar de efectivo"
              />
            </div>

            {corregirMutation.error && (
              <p role="alert" className="text-sm text-destructive">{corregirMutation.error.message}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setVentaAEditar(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => corregirMutation.mutate()}
              disabled={
                corregirMutation.isPending ||
                productosQuery.isLoading ||
                cuentasQuery.isLoading ||
                jugadoresQuery.isLoading ||
                !motivo.trim() ||
                itemsDraft.length === 0 ||
                pagosDraft.length === 0 ||
                itemsDraft.some((item) => {
                  const producto = productos.find((candidate) => candidate.id === item.productoId);
                  const estabaEnVentaOriginal = ventaAEditar?.items.some(
                    (ventaItem) => ventaItem.producto_id === item.productoId,
                  ) ?? false;
                  return !producto || (!producto.activo && !estabaEnVentaOriginal);
                }) ||
                pagosDraft.some((pago) => pago.medioPago === 'cuenta_corriente' && pago.jugadorId === null) ||
                Math.round(totalVentaDraft * 100) !== Math.round(totalPagosDraft * 100)
              }
            >
              {corregirMutation.isPending ? 'Guardando...' : 'Guardar corrección'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={ventaAAnular !== null}
        onOpenChange={(open) => {
          if (!open) setVentaAAnular(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anular venta #{ventaAAnular?.id}</DialogTitle>
            <DialogDescription>
              Se revertirá el stock y el registro financiero. La venta original permanecerá en el historial.
              Si su efectivo pertenece a una caja ya cerrada, el ajuste se asentará en la caja abierta actual.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="venta-anulacion-motivo">Motivo de la anulación</Label>
            <Input
              id="venta-anulacion-motivo"
              value={motivoAnulacion}
              onChange={(event) => setMotivoAnulacion(event.target.value)}
              maxLength={500}
              placeholder="Describí por qué se anula la venta"
            />
            {anularMutation.error && (
              <p role="alert" className="text-sm text-destructive">{anularMutation.error.message}</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setVentaAAnular(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (ventaAAnular) {
                  anularMutation.mutate({
                    ventaId: ventaAAnular.id,
                    motivo: motivoAnulacion.trim(),
                  });
                }
              }}
              disabled={anularMutation.isPending || !motivoAnulacion.trim()}
            >
              {anularMutation.isPending ? 'Anulando...' : 'Confirmar anulación'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
