import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { Linea, TipoUnidad } from '@/types/database';

/**
 * Resumen financiero del período (criterio devengado pragmático:
 * usamos fecha del registro principal en cada tabla, no estricto
 * por unidad temporal — buena base para un EERR operativo,
 * mejorable en iteración futura cuando armemos el EERR formal).
 *
 * El cálculo se hace client-side desde 5 queries paralelas. Para
 * volumen alto (>10k registros/mes), reemplazar por RPC con
 * agregaciones SQL. Hoy alcanza con esto.
 */
export interface IngresoUnidad {
  unidad: string;
  tipo: TipoUnidad;
  monto: number;
}

export interface GastoCategoria {
  categoria_nombre: string;
  unidad_nombre: string;
  unidad_tipo: TipoUnidad;
  monto: number;
}

export interface MovimientoReciente {
  id: string;
  tipo: 'gasto' | 'otro_ingreso' | 'cobro_reserva' | 'venta' | 'cobro_clase';
  fecha: string;
  descripcion: string;
  detalle: string | null;
  monto: number;
  signo: '+' | '-';
}

export interface ResumenFinanciero {
  /** Mes del período (1-12). */
  mes: number;
  anio: number;
  /** Total de ingresos (operativos + otros), antes de costos/gastos. */
  ingresos_total: number;
  ingresos_por_unidad: IngresoUnidad[];
  /** Costo directo de venta (buffet + shop), basado en costo_unitario snapshot. */
  costos_directos: number;
  costos_por_linea: { linea: Linea; monto: number }[];
  /** Gastos operativos (unidades con tipo automático: canchas/clases/buffet/shop). */
  gastos_operativos: number;
  /** Gastos de estructura (unidad tipo='estructura'). */
  gastos_estructura: number;
  /** Otros gastos (auspicios/membresias/otro). */
  gastos_otros: number;
  /** Total gastos = operativos + estructura + otros. */
  gastos_total: number;
  /** Resultado = ingresos − costos − gastos. */
  resultado_neto: number;
  /** % margen sobre ingresos. NaN si ingresos = 0. */
  margen_porcentaje: number;
  /** Top categorías de gasto del período (ordenadas DESC). */
  top_gastos_categoria: GastoCategoria[];
  /** Movimientos recientes mixtos (últimos 15). */
  movimientos_recientes: MovimientoReciente[];
}

export const RESUMEN_FINANCIERO_QUERY_KEY = (anio: number, mes: number) =>
  ['resumen_financiero', anio, mes] as const;

function rangoMes(anio: number, mes: number): { desde: string; hasta: string } {
  // mes: 1-12. Devuelve YYYY-MM-DD del primer y último día.
  const desde = new Date(anio, mes - 1, 1);
  const hasta = new Date(anio, mes, 0); // día 0 del mes siguiente = último día del actual
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { desde: fmt(desde), hasta: fmt(hasta) };
}

export function useResumenFinanciero(
  anio: number,
  mes: number,
): UseQueryResult<ResumenFinanciero, Error> {
  return useQuery<ResumenFinanciero, Error>({
    queryKey: RESUMEN_FINANCIERO_QUERY_KEY(anio, mes),
    queryFn: async () => {
      const { desde, hasta } = rangoMes(anio, mes);
      const desdeISO = `${desde}T00:00:00`;
      const hastaISO = `${hasta}T23:59:59`;

      // 5 queries en paralelo. Lecturas simples; la RLS filtra por club.
      const [pagosRes, ventasRes, clasesRes, otrosIngRes, gastosRes] =
        await Promise.all([
          // 1. reserva_pagos del mes (criterio: fecha_hora del cobro).
          //    Reembolsos restan.
          supabase
            .from('reserva_pagos')
            .select('monto, tipo, fecha_hora')
            .gte('fecha_hora', desdeISO)
            .lte('fecha_hora', hastaISO),
          // 2. ventas del mes (fecha_hora). El desglose por línea lo
          //    hacemos sobre venta_items (que tiene snapshot de linea
          //    desde 0024).
          supabase
            .from('ventas')
            .select('id, monto_total, fecha_hora')
            .gte('fecha_hora', desdeISO)
            .lte('fecha_hora', hastaISO),
          // 3. clase_cobros del mes (fecha_hora del cobro).
          supabase
            .from('clase_cobros')
            .select('monto, fecha_hora')
            .gte('fecha_hora', desdeISO)
            .lte('fecha_hora', hastaISO),
          // 4. otros_ingresos del mes (devengado = fecha).
          supabase
            .from('otros_ingresos')
            .select('monto, fecha, unidad_nombre, unidad_tipo')
            .eq('activo', true)
            .gte('fecha', desde)
            .lte('fecha', hasta),
          // 5. gastos del mes (devengado = fecha_gasto).
          supabase
            .from('gastos')
            .select('id, monto, fecha_gasto, categoria_nombre, unidad_nombre, unidad_tipo, proveedor')
            .eq('activo', true)
            .gte('fecha_gasto', desde)
            .lte('fecha_gasto', hasta)
            .order('fecha_gasto', { ascending: false }),
        ]);

      for (const r of [pagosRes, ventasRes, clasesRes, otrosIngRes, gastosRes]) {
        if (r.error) throw new Error(mapPostgrestError(r.error));
      }

      // ── Ingresos por unidad ────────────────────────────────────────
      const pagos = (pagosRes.data ?? []) as Array<{ monto: number; tipo: string; fecha_hora: string }>;
      const ingresoCanchas = pagos.reduce(
        (acc, p) =>
          acc + (p.tipo === 'reembolso' ? -Number(p.monto) : Number(p.monto)),
        0,
      );

      const ventas = (ventasRes.data ?? []) as Array<{ id: number; monto_total: number; fecha_hora: string }>;

      // Re-fetch ligero de venta_items con precio_unitario incluido,
      // para poder desglosar ingresos buffet vs shop. El itemsRes
      // anterior no incluía precio_unitario; lo agregamos acá. (En una
      // iteración futura, se unifica en una sola query.)
      type VentaItemFull = {
        cantidad: number;
        precio_unitario: number;
        costo_unitario: number | null;
        linea: Linea;
        ventas: { fecha_hora: string } | null;
      };
      const { data: itemsConPrecio, error: itemsPrecioErr } = await supabase
        .from('venta_items')
        .select('cantidad, precio_unitario, costo_unitario, linea, ventas!inner(fecha_hora)')
        .gte('ventas.fecha_hora', desdeISO)
        .lte('ventas.fecha_hora', hastaISO);
      if (itemsPrecioErr) throw new Error(mapPostgrestError(itemsPrecioErr));
      const itemsFull = (itemsConPrecio ?? []) as unknown as VentaItemFull[];

      let ingresoBuffet = 0;
      let ingresoShop = 0;
      let costoBuffet = 0;
      let costoShop = 0;
      for (const it of itemsFull) {
        const ingreso = Number(it.precio_unitario) * Number(it.cantidad);
        const costo = it.costo_unitario === null ? 0 : Number(it.costo_unitario) * Number(it.cantidad);
        if (it.linea === 'buffet') {
          ingresoBuffet += ingreso;
          costoBuffet += costo;
        } else {
          ingresoShop += ingreso;
          costoShop += costo;
        }
      }

      const clases = (clasesRes.data ?? []) as Array<{ monto: number; fecha_hora: string }>;
      const ingresoClases = clases.reduce((acc, c) => acc + Number(c.monto), 0);

      const otrosIng = (otrosIngRes.data ?? []) as Array<{
        monto: number;
        fecha: string;
        unidad_nombre: string;
        unidad_tipo: TipoUnidad;
      }>;
      // Agrupar otros_ingresos por unidad.
      const otrosPorUnidad = new Map<string, { tipo: TipoUnidad; monto: number }>();
      for (const i of otrosIng) {
        const key = i.unidad_nombre;
        const prev = otrosPorUnidad.get(key);
        otrosPorUnidad.set(key, {
          tipo: i.unidad_tipo,
          monto: (prev?.monto ?? 0) + Number(i.monto),
        });
      }

      const ingresos_por_unidad: IngresoUnidad[] = [];
      if (ingresoCanchas > 0) ingresos_por_unidad.push({ unidad: 'Canchas', tipo: 'canchas', monto: ingresoCanchas });
      if (ingresoClases > 0) ingresos_por_unidad.push({ unidad: 'Clases', tipo: 'clases', monto: ingresoClases });
      if (ingresoBuffet > 0) ingresos_por_unidad.push({ unidad: 'Buffet', tipo: 'buffet', monto: ingresoBuffet });
      if (ingresoShop > 0) ingresos_por_unidad.push({ unidad: 'Shop', tipo: 'shop', monto: ingresoShop });
      for (const [unidad, info] of otrosPorUnidad) {
        ingresos_por_unidad.push({ unidad, tipo: info.tipo, monto: info.monto });
      }
      ingresos_por_unidad.sort((a, b) => b.monto - a.monto);

      const ingresos_total = ingresos_por_unidad.reduce((acc, i) => acc + i.monto, 0);

      // ── Costos directos ────────────────────────────────────────────
      const costos_directos = costoBuffet + costoShop;
      const costos_por_linea: { linea: Linea; monto: number }[] = [];
      if (costoBuffet > 0) costos_por_linea.push({ linea: 'buffet', monto: costoBuffet });
      if (costoShop > 0) costos_por_linea.push({ linea: 'shop', monto: costoShop });

      // ── Gastos por unidad/categoría ────────────────────────────────
      const gastos = (gastosRes.data ?? []) as Array<{
        id: number;
        monto: number;
        fecha_gasto: string;
        categoria_nombre: string;
        unidad_nombre: string;
        unidad_tipo: TipoUnidad;
        proveedor: string | null;
      }>;

      let gastos_operativos = 0;
      let gastos_estructura = 0;
      let gastos_otros = 0;
      const porCategoria = new Map<string, GastoCategoria>();
      for (const g of gastos) {
        const monto = Number(g.monto);
        if (
          g.unidad_tipo === 'canchas' ||
          g.unidad_tipo === 'clases' ||
          g.unidad_tipo === 'buffet' ||
          g.unidad_tipo === 'shop'
        ) {
          gastos_operativos += monto;
        } else if (g.unidad_tipo === 'estructura') {
          gastos_estructura += monto;
        } else {
          gastos_otros += monto;
        }

        const key = `${g.unidad_nombre}::${g.categoria_nombre}`;
        const prev = porCategoria.get(key);
        porCategoria.set(key, {
          categoria_nombre: g.categoria_nombre,
          unidad_nombre: g.unidad_nombre,
          unidad_tipo: g.unidad_tipo,
          monto: (prev?.monto ?? 0) + monto,
        });
      }
      const top_gastos_categoria = Array.from(porCategoria.values())
        .sort((a, b) => b.monto - a.monto)
        .slice(0, 8);
      const gastos_total = gastos_operativos + gastos_estructura + gastos_otros;

      // ── Resultado ──────────────────────────────────────────────────
      const resultado_neto = ingresos_total - costos_directos - gastos_total;
      const margen_porcentaje =
        ingresos_total > 0 ? (resultado_neto / ingresos_total) * 100 : NaN;

      // ── Movimientos recientes (mixtos, últimos 15 por fecha) ───────
      const movs: MovimientoReciente[] = [];

      // Otros ingresos (top 10 del mes por fecha DESC; ya filtrados).
      for (const i of otrosIng) {
        movs.push({
          id: `oi-${i.fecha}-${i.unidad_nombre}-${i.monto}`,
          tipo: 'otro_ingreso',
          fecha: i.fecha,
          descripcion: i.unidad_nombre,
          detalle: null,
          monto: Number(i.monto),
          signo: '+',
        });
      }
      // Gastos.
      for (const g of gastos) {
        movs.push({
          id: `g-${g.id}`,
          tipo: 'gasto',
          fecha: g.fecha_gasto,
          descripcion: g.categoria_nombre,
          detalle: g.proveedor ?? g.unidad_nombre,
          monto: Number(g.monto),
          signo: '-',
        });
      }
      // Ventas (mostramos las top 5 más recientes para no inflar).
      for (const v of ventas.slice(0, 5)) {
        movs.push({
          id: `v-${v.id}`,
          tipo: 'venta',
          fecha: v.fecha_hora,
          descripcion: `Venta mostrador #${v.id}`,
          detalle: null,
          monto: Number(v.monto_total),
          signo: '+',
        });
      }

      movs.sort((a, b) => b.fecha.localeCompare(a.fecha));
      const movimientos_recientes = movs.slice(0, 15);

      return {
        mes,
        anio,
        ingresos_total,
        ingresos_por_unidad,
        costos_directos,
        costos_por_linea,
        gastos_operativos,
        gastos_estructura,
        gastos_otros,
        gastos_total,
        resultado_neto,
        margen_porcentaje,
        top_gastos_categoria,
        movimientos_recientes,
      };
    },
  });
}
