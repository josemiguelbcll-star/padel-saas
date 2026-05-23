import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type {
  CompraTipo,
  CondicionPago,
  EstadoCompra,
  Linea,
  MedioPago,
} from '@/types/database';

export interface CompraListaFila {
  id: number;
  estado: EstadoCompra;
  fecha_oc: string;
  fecha_recepcion: string | null;
  linea: Linea;
  tipo: CompraTipo;
  condicion_pago: CondicionPago;
  fecha_compromiso_pago: string | null;
  /** Monto comprometido al pedir (NETO). Siempre disponible. */
  monto_neto_oc: number;
  /** Total recibido = neto + IVA. NULL en pedida/cancelada. */
  monto_total: number | null;
  observaciones: string | null;
  proveedor_id: number;
  proveedor_nombre: string | null;
  /**
   * 'pagada' si el gasto vinculado tiene fecha_pago.
   * 'pendiente' si la compra recibida tiene gasto sin pago aún.
   * NULL si la compra está pedida o cancelada (no aplica).
   */
  pago_estado: 'pagada' | 'pendiente' | null;
  pago_medio: MedioPago | null;
  items_count: number;
}

export interface UseComprasParams {
  /** YYYY-MM-DD inclusivo. Se compara contra fecha_oc. */
  desde: string;
  /** YYYY-MM-DD inclusivo. Se compara contra fecha_oc. */
  hasta: string;
  /** null = todos los proveedores. */
  proveedorId: number | null;
  /** null = ambas líneas. */
  linea: Linea | null;
  /** null = todos los estados. */
  estado: EstadoCompra | null;
}

export const COMPRAS_QUERY_KEY = (params: UseComprasParams) =>
  [
    'compras',
    params.desde,
    params.hasta,
    params.proveedorId,
    params.linea,
    params.estado,
  ] as const;

/** Prefijo para invalidaciones masivas (mutation onSuccess). */
export const COMPRAS_QUERY_KEY_BASE = ['compras'] as const;

/**
 * Lista de compras (OC) dentro de un rango temporal. Filtra por
 * fecha_oc (no por fecha_recepcion — la línea conceptual es "cuándo
 * armaste la compra"). Embeds proveedor (nombre) + gastos (fecha_pago,
 * medio_pago) + count de items.
 *
 * Orden: estado='pedida' primero (más accionable), luego fecha_oc DESC.
 */
export function useCompras(
  params: UseComprasParams,
): UseQueryResult<CompraListaFila[], Error> {
  return useQuery<CompraListaFila[], Error>({
    queryKey: COMPRAS_QUERY_KEY(params),
    queryFn: async () => {
      let q = supabase
        .from('compras')
        .select(
          `
          id, estado, fecha_oc, fecha_recepcion, linea, tipo,
          condicion_pago, fecha_compromiso_pago,
          monto_neto_oc, monto_total, observaciones,
          proveedor_id,
          proveedores:proveedor_id (nombre),
          gastos:gasto_id (fecha_pago, medio_pago),
          compra_items (count)
          `,
        )
        .gte('fecha_oc', params.desde)
        .lte('fecha_oc', params.hasta)
        // Pedidas arriba (más accionable). Después por fecha desc.
        .order('estado', { ascending: true })
        .order('fecha_oc', { ascending: false })
        .order('id', { ascending: false });

      if (params.proveedorId !== null) {
        q = q.eq('proveedor_id', params.proveedorId);
      }
      if (params.linea !== null) {
        q = q.eq('linea', params.linea);
      }
      if (params.estado !== null) {
        q = q.eq('estado', params.estado);
      }

      const { data, error } = await q;
      if (error) throw new Error(mapPostgrestError(error));

      // Los embeds many-to-one llegan como objeto único en runtime
      // (PostgREST los tipa como array). Patrón estándar del codebase.
      type Row = {
        id: number;
        estado: EstadoCompra;
        fecha_oc: string;
        fecha_recepcion: string | null;
        linea: Linea;
        tipo: CompraTipo;
        condicion_pago: CondicionPago;
        fecha_compromiso_pago: string | null;
        monto_neto_oc: number;
        monto_total: number | null;
        observaciones: string | null;
        proveedor_id: number;
        proveedores: { nombre: string } | null;
        gastos: { fecha_pago: string | null; medio_pago: MedioPago | null } | null;
        compra_items: Array<{ count: number }>;
      };

      return ((data ?? []) as unknown as Row[]).map((r) => {
        const itemsCount = r.compra_items?.[0]?.count ?? 0;
        let pago_estado: 'pagada' | 'pendiente' | null;
        if (r.estado !== 'recibida' || r.tipo !== 'compra' || r.gastos === null) {
          pago_estado = null;
        } else {
          pago_estado = r.gastos.fecha_pago !== null ? 'pagada' : 'pendiente';
        }
        return {
          id: r.id,
          estado: r.estado,
          fecha_oc: r.fecha_oc,
          fecha_recepcion: r.fecha_recepcion,
          linea: r.linea,
          tipo: r.tipo,
          condicion_pago: r.condicion_pago,
          fecha_compromiso_pago: r.fecha_compromiso_pago,
          monto_neto_oc: Number(r.monto_neto_oc),
          monto_total: r.monto_total === null ? null : Number(r.monto_total),
          observaciones: r.observaciones,
          proveedor_id: r.proveedor_id,
          proveedor_nombre: r.proveedores?.nombre ?? null,
          pago_estado,
          pago_medio: r.gastos?.medio_pago ?? null,
          items_count: itemsCount,
        };
      });
    },
  });
}
