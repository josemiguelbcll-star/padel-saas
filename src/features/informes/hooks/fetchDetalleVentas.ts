import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import {
  topProductosVendidos,
  totalesPorUnidad,
  type ProductoVendido,
  type TotalesUnidad,
} from '../utils/informeTurno';
import type { CobroClaseRaw, PagoReservaRaw } from './fetchCobrosInforme';

export interface DetalleVentas {
  unidades: TotalesUnidad;
  topProductos: ProductoVendido[];
  /** Margen bruto POS: Σ(subtotal − costo_unitario×cantidad) sobre items
   *  con costo cargado (costo NULL = no calculable, se excluye). */
  margenPositivo: number;
  margenBase: number;
  /** Unidades y monto de insumos facturados (POS + consumos turno +
   *  consumos clase del alcance). */
  insumosUnidades: number;
  insumosMonto: number;
}

/**
 * Desglose por unidad de negocio (regla de oro) + ranking de productos
 * más vendidos para un conjunto de cobros ya atribuidos.
 *
 *   - Canchas  ← reserva_pagos.monto_alquiler
 *   - Clases   ← clase_cobros.monto_clase (fallback monto)
 *   - Buffet/Shop ← reserva_consumos.linea + clase_consumos.linea +
 *     venta_items.linea (consumos del turno y de clase se toman de las
 *     reservas/clases cobradas; ventas solo de ventas activas).
 */
export async function fetchDetalleVentas(input: {
  pagosReserva: PagoReservaRaw[];
  cobrosClase: CobroClaseRaw[];
  ventaIds: number[];
}): Promise<DetalleVentas> {
  const { pagosReserva, cobrosClase, ventaIds } = input;

  const reservaIds = [
    ...new Set(
      pagosReserva
        .filter((p) => p.tipo !== 'reembolso')
        .map((p) => p.reserva_id),
    ),
  ];
  const claseKeys = [
    ...new Set(cobrosClase.map((c) => `${c.clase_id}|${c.fecha}`)),
  ];
  const claseIds = [...new Set(cobrosClase.map((c) => c.clase_id))];

  const [consTurnoRes, consClaseRes, itemsVentaRes, ventasInfoRes] =
    await Promise.all([
      reservaIds.length > 0
        ? supabase
            .from('reserva_consumos')
            .select('reserva_id, producto_nombre, cantidad, subtotal, linea')
            .in('reserva_id', reservaIds)
        : Promise.resolve({ data: [], error: null }),
      claseIds.length > 0
        ? supabase
            .from('clase_consumos')
            .select(
              'clase_id, fecha, producto_nombre, cantidad, subtotal, linea',
            )
            .in('clase_id', claseIds)
        : Promise.resolve({ data: [], error: null }),
      ventaIds.length > 0
        ? supabase
            .from('venta_items')
            .select(
              'venta_id, producto_nombre, cantidad, subtotal, costo_unitario, linea',
            )
            .in('venta_id', ventaIds)
        : Promise.resolve({ data: [], error: null }),
      ventaIds.length > 0
        ? supabase
            .from('ventas')
            .select('id, activa')
            .in('id', ventaIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

  for (const r of [
    consTurnoRes,
    consClaseRes,
    itemsVentaRes,
    ventasInfoRes,
  ]) {
    if (r.error) throw new Error(mapPostgrestError(r.error));
  }

  const activasSet = new Set(
    ((ventasInfoRes.data ?? []) as Array<{ id: number; activa: boolean }>)
      .filter((v) => v.activa)
      .map((v) => v.id),
  );
  const claseKeysSet = new Set(claseKeys);

  const consumosReserva = (
    (consTurnoRes.data ?? []) as Array<{
      reserva_id: number;
      linea: string;
      subtotal: number;
    }>
  ).map((c) => ({ linea: c.linea, subtotal: Number(c.subtotal) }));

  const consumosClaseFilas = (
    (consClaseRes.data ?? []) as Array<{
      clase_id: number;
      fecha: string;
      linea: string;
      subtotal: number;
      producto_nombre: string;
      cantidad: number;
    }>
  ).filter((c) => claseKeysSet.has(`${c.clase_id}|${c.fecha}`));

  const consumosClase = consumosClaseFilas.map((c) => ({
    linea: c.linea,
    subtotal: Number(c.subtotal),
  }));

  const itemsVentaFilas = (
    (itemsVentaRes.data ?? []) as Array<{
      venta_id: number;
      producto_nombre: string;
      cantidad: number;
      subtotal: number;
      costo_unitario: number | null;
      linea: string;
    }>
  ).filter((it) => activasSet.has(it.venta_id));

  const itemsVenta = itemsVentaFilas.map((it) => ({
    linea: it.linea,
    subtotal: Number(it.subtotal),
  }));

  const unidades = totalesPorUnidad({
    pagosReserva: pagosReserva.map((p) => ({
      monto_alquiler:
        Number(p.monto_alquiler) * (p.tipo === 'reembolso' ? -1 : 1),
      monto_consumo: Number(p.monto_consumo),
    })),
    cobrosClase: cobrosClase.map((c) => ({
      monto: Number(c.monto),
      monto_clase: c.monto_clase,
    })),
    consumosReserva,
    consumosClase,
    itemsVenta,
  });

  // Margen e insumos sobre el mismo universo (POS activas + consumos).
  let margenPositivo = 0;
  let margenBase = 0;
  for (const it of itemsVentaFilas) {
    const sub = Number(it.subtotal);
    margenBase += sub;
    if (it.costo_unitario !== null && it.costo_unitario !== undefined) {
      margenPositivo += sub - Number(it.costo_unitario) * Number(it.cantidad);
    }
  }
  const insumosUnidades =
    itemsVentaFilas.reduce((a, it) => a + (Number(it.cantidad) || 0), 0) +
    (consTurnoRes.data ?? []).reduce(
      (a, c) => a + (Number((c as { cantidad: number }).cantidad) || 0),
      0,
    ) +
    consumosClaseFilas.reduce(
      (a, c) => a + (Number(c.cantidad) || 0),
      0,
    );
  const insumosMonto =
    itemsVentaFilas.reduce((a, it) => a + Number(it.subtotal), 0) +
    (consTurnoRes.data ?? []).reduce(
      (a, c) => a + Number((c as { subtotal: number }).subtotal),
      0,
    ) +
    consumosClaseFilas.reduce((a, c) => a + Number(c.subtotal), 0);

  const topItems = [
    ...((consTurnoRes.data ?? []) as Array<{
      producto_nombre: string;
      cantidad: number;
      subtotal: number;
    }>),
    ...consumosClaseFilas,
    ...itemsVentaFilas,
  ];

  return {
    unidades,
    topProductos: topProductosVendidos(topItems),
    margenPositivo,
    margenBase,
    insumosUnidades,
    insumosMonto,
  };
}
