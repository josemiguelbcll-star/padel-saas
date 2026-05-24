import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { TipoUnidad } from '@/types/database';

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
          gastos:gasto_id (
            categoria_nombre, unidad_nombre, unidad_tipo, proveedor,
            gastos_recurrentes:gasto_recurrente_id ( concepto ),
            gasto_cuotas (count)
          ),
          compras:gasto_id (id)
          `,
        )
        .is('fecha_pago', null)
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
