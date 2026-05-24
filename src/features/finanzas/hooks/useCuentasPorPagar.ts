import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { MedioPago, TipoUnidad } from '@/types/database';

export interface CuentaPorPagarFila {
  /** Id de la cuota (gasto_cuotas.id). */
  id: number;
  /** Id del gasto madre. */
  gasto_id: number;
  numero: number;
  es_anticipo: boolean;
  monto: number;
  fecha_vencimiento: string | null;
  /** Datos del gasto madre (snapshot al cargar). */
  categoria_nombre: string;
  unidad_nombre: string;
  unidad_tipo: TipoUnidad;
  /** Snapshot del nombre del proveedor en gastos. NULL si carga manual. */
  proveedor: string | null;
  /** Si el gasto vino de una plantilla recurrente (0046), el concepto
   *  de la plantilla (ej. "Luz", "Sueldo Juan"). NULL si no vino de
   *  recurrente. Se usa como fallback del título cuando `proveedor`
   *  es NULL (típico en sueldos y otros gastos sin proveedor formal). */
  concepto_recurrente: string | null;
  /** Si el gasto vino de una OC, esta es la compra madre (para mostrar
   *  "Compra #X" en la fila). NULL en gastos manuales. */
  compra_id: number | null;
  /** Conteo TOTAL de cuotas del gasto madre (pagadas + pendientes).
   *  Se usa para mostrar "Cuota N de M". Anticipos también cuentan. */
  total_cuotas: number;
}

export const CXP_QUERY_KEY = ['cxp'] as const;

/**
 * Cuotas pendientes de pago (cuentas por pagar) del club. Lista
 * cronológica por vencimiento ascendente, con NULLs (sin fecha) al
 * final.
 *
 * Embed:
 *   - gastos:gasto_id → datos del gasto madre (categoría, unidad,
 *     proveedor snapshot).
 *   - compras:gasto_id (reverse via compras.gasto_id) → si el gasto
 *     vino de una OC, el id de la compra para mostrar "Compra #X".
 *   - gasto_cuotas(count) bajo el gasto → cantidad total de cuotas
 *     del gasto madre (para mostrar "Cuota N de M").
 *
 * Solo trae cuotas con fecha_pago IS NULL. Al pagar una cuota,
 * desaparece automáticamente de la lista (la mutation invalida
 * ['cxp']).
 *
 * Filtra por `gastos.activo = true` (embed !inner): si el gasto madre
 * fue anulado (0048), sus cuotas pendientes NO deben aparecer en CxP.
 */
export function useCuentasPorPagar(): UseQueryResult<
  CuentaPorPagarFila[],
  Error
> {
  return useQuery<CuentaPorPagarFila[], Error>({
    queryKey: CXP_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gasto_cuotas')
        .select(
          `
          id, gasto_id, numero, es_anticipo, monto, fecha_vencimiento,
          gastos:gasto_id!inner (
            categoria_nombre, unidad_nombre, unidad_tipo, proveedor,
            gastos_recurrentes:gasto_recurrente_id ( concepto ),
            gasto_cuotas (count)
          ),
          compras:gasto_id (id)
          `,
        )
        .is('fecha_pago', null)
        .eq('gastos.activo', true)
        .order('fecha_vencimiento', {
          ascending: true,
          nullsFirst: false,
        })
        .order('id', { ascending: true });
      if (error) throw new Error(mapPostgrestError(error));

      // Los embeds many-to-one llegan como objeto único; el embed
      // reverso (compras tiene FK a gastos vía gasto_id) llega como
      // array — puede ser 0 (sin compra, gasto manual) o 1 (con OC).
      // El embed agregado gasto_cuotas(count) viene como array de 1
      // objeto con shape { count: N }.
      type Row = {
        id: number;
        gasto_id: number;
        numero: number;
        es_anticipo: boolean;
        monto: number;
        fecha_vencimiento: string | null;
        gastos: {
          categoria_nombre: string;
          unidad_nombre: string;
          unidad_tipo: TipoUnidad;
          proveedor: string | null;
          gastos_recurrentes: { concepto: string } | null;
          gasto_cuotas: Array<{ count: number }>;
        } | null;
        compras: Array<{ id: number }>;
      };

      return ((data ?? []) as unknown as Row[]).map((r) => {
        const totalCuotas = r.gastos?.gasto_cuotas?.[0]?.count ?? 0;
        const compraId = r.compras?.[0]?.id ?? null;
        return {
          id: r.id,
          gasto_id: r.gasto_id,
          numero: r.numero,
          es_anticipo: r.es_anticipo,
          monto: Number(r.monto),
          fecha_vencimiento: r.fecha_vencimiento,
          categoria_nombre: r.gastos?.categoria_nombre ?? '(eliminada)',
          unidad_nombre: r.gastos?.unidad_nombre ?? '',
          unidad_tipo: (r.gastos?.unidad_tipo ?? 'otro') as TipoUnidad,
          proveedor: r.gastos?.proveedor ?? null,
          concepto_recurrente: r.gastos?.gastos_recurrentes?.concepto ?? null,
          compra_id: compraId,
          total_cuotas: totalCuotas,
        };
      });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// Pagos recientes de cuotas (para "Anular pago" — 0048)
// ─────────────────────────────────────────────────────────────────────

/** Una cuota PAGADA recientemente, con los datos del pago. */
export interface PagoCuotaReciente {
  id: number;
  gasto_id: number;
  numero: number;
  es_anticipo: boolean;
  monto: number;
  /** Fecha en que se pagó (NOT NULL por definición de la lista). */
  fecha_pago: string;
  medio_pago: MedioPago | null;
  categoria_nombre: string;
  unidad_nombre: string;
  unidad_tipo: TipoUnidad;
  proveedor: string | null;
  concepto_recurrente: string | null;
  compra_id: number | null;
  total_cuotas: number;
}

export const CXP_PAGOS_RECIENTES_QUERY_KEY = ['cxp-pagos-recientes'] as const;

/** Ventana de pagos recientes que se ofrecen para anular. */
const DIAS_PAGOS_RECIENTES = 60;

function isoHaceDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Cuotas PAGADAS en los últimos `DIAS_PAGOS_RECIENTES` días, para la
 * sección "Pagos recientes" de CxP donde se puede anular un pago
 * (fn_anular_pago_cuota, 0048). Ordenadas por fecha_pago DESC.
 *
 * Filtra por `gastos.activo = true` (embed !inner): no mostramos pagos
 * de gastos ya anulados. Al anular un pago, la cuota vuelve a pendiente
 * → reaparece arriba en su bucket de vencimiento y desaparece de acá
 * (la mutation invalida ambas keys).
 */
export function usePagosCuotaRecientes(): UseQueryResult<
  PagoCuotaReciente[],
  Error
> {
  return useQuery<PagoCuotaReciente[], Error>({
    queryKey: CXP_PAGOS_RECIENTES_QUERY_KEY,
    queryFn: async () => {
      const desde = isoHaceDias(DIAS_PAGOS_RECIENTES);
      const { data, error } = await supabase
        .from('gasto_cuotas')
        .select(
          `
          id, gasto_id, numero, es_anticipo, monto, fecha_pago, medio_pago,
          gastos:gasto_id!inner (
            categoria_nombre, unidad_nombre, unidad_tipo, proveedor,
            gastos_recurrentes:gasto_recurrente_id ( concepto ),
            gasto_cuotas (count)
          ),
          compras:gasto_id (id)
          `,
        )
        .gte('fecha_pago', desde)
        .eq('gastos.activo', true)
        .order('fecha_pago', { ascending: false })
        .order('id', { ascending: false });
      if (error) throw new Error(mapPostgrestError(error));

      type Row = {
        id: number;
        gasto_id: number;
        numero: number;
        es_anticipo: boolean;
        monto: number;
        fecha_pago: string;
        medio_pago: MedioPago | null;
        gastos: {
          categoria_nombre: string;
          unidad_nombre: string;
          unidad_tipo: TipoUnidad;
          proveedor: string | null;
          gastos_recurrentes: { concepto: string } | null;
          gasto_cuotas: Array<{ count: number }>;
        } | null;
        compras: Array<{ id: number }>;
      };

      return ((data ?? []) as unknown as Row[]).map((r) => ({
        id: r.id,
        gasto_id: r.gasto_id,
        numero: r.numero,
        es_anticipo: r.es_anticipo,
        monto: Number(r.monto),
        fecha_pago: r.fecha_pago,
        medio_pago: r.medio_pago,
        categoria_nombre: r.gastos?.categoria_nombre ?? '(eliminada)',
        unidad_nombre: r.gastos?.unidad_nombre ?? '',
        unidad_tipo: (r.gastos?.unidad_tipo ?? 'otro') as TipoUnidad,
        proveedor: r.gastos?.proveedor ?? null,
        concepto_recurrente: r.gastos?.gastos_recurrentes?.concepto ?? null,
        compra_id: r.compras?.[0]?.id ?? null,
        total_cuotas: r.gastos?.gasto_cuotas?.[0]?.count ?? 0,
      }));
    },
  });
}
