import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { FuenteMovimientoStock, Linea } from '@/types/database';

/**
 * Movimiento de stock para la vista de auditoría (Bloque 3). Trae info
 * contextual del producto y del usuario que registró el movimiento via
 * embeds de PostgREST. Si el producto fue borrado (no debería ocurrir,
 * la FK es ON DELETE RESTRICT) o el usuario es NULL, dejamos los
 * fallbacks en la UI.
 */
export interface MovimientoStockAuditoria {
  id: number;
  producto_id: number;
  producto_nombre: string | null;
  producto_linea: Linea | null;
  cantidad: number;
  fuente: FuenteMovimientoStock;
  venta_id: number | null;
  reserva_consumo_id: number | null;
  observaciones: string | null;
  usuario_id: string;
  usuario_nombre: string | null;
  fecha_hora: string;
}

export interface UseMovimientosStockParams {
  /** Si está seteado, filtra a un solo producto. */
  productoId: number | null;
  /** Si está seteado, filtra a una sola fuente. */
  fuente: FuenteMovimientoStock | null;
  /** Inicio del rango (ISO date YYYY-MM-DD, INCLUSIVE). */
  desde: string;
  /** Fin del rango (ISO date YYYY-MM-DD, INCLUSIVE). */
  hasta: string;
}

export const MOVIMIENTOS_STOCK_QUERY_KEY = (params: UseMovimientosStockParams) =>
  [
    'inventario',
    'movimientos',
    params.productoId,
    params.fuente,
    params.desde,
    params.hasta,
  ] as const;

/**
 * Lista de movimientos de stock dentro de un rango temporal, con embeds
 * de `productos` (nombre, línea) y `usuarios` (nombre). Ordenado DESC
 * por fecha_hora. RLS server-side filtra por club; este hook NO agrega
 * filtro de club_id manual (sería redundante y propenso a errores).
 *
 * Volumen esperado: un buffet activo genera ~50-200 movimientos por
 * mes. La RPC sin paginar es suficiente para los rangos típicos
 * (7/30/90 días). No agregamos LIMIT — si se vuelve un problema, se
 * pagina después.
 */
export function useMovimientosStock(
  params: UseMovimientosStockParams,
): UseQueryResult<MovimientoStockAuditoria[], Error> {
  return useQuery<MovimientoStockAuditoria[], Error>({
    queryKey: MOVIMIENTOS_STOCK_QUERY_KEY(params),
    queryFn: async () => {
      // El rango temporal está en TIMESTAMPTZ; pasamos límites como
      // 'YYYY-MM-DDTHH:MM:SS' (sin zona) para que la comparación se
      // haga en la zona del cliente que ya muestra los datos.
      const desdeIni = `${params.desde}T00:00:00`;
      const hastaFin = `${params.hasta}T23:59:59`;

      let q = supabase
        .from('movimientos_stock')
        .select(
          `
          id, producto_id, cantidad, fuente, venta_id,
          reserva_consumo_id, observaciones, usuario_id, fecha_hora,
          productos:producto_id (nombre, linea),
          usuarios:usuario_id (nombre)
          `,
        )
        .gte('fecha_hora', desdeIni)
        .lte('fecha_hora', hastaFin)
        .order('fecha_hora', { ascending: false });

      if (params.productoId !== null) {
        q = q.eq('producto_id', params.productoId);
      }
      if (params.fuente !== null) {
        q = q.eq('fuente', params.fuente);
      }

      const { data, error } = await q;
      if (error) throw new Error(mapPostgrestError(error));

      // Los embeds many-to-one llegan como objeto único en runtime
      // aunque PostgREST los infiera como array. Mismo patrón que
      // useMovimientosCaja.
      type Row = {
        id: number;
        producto_id: number;
        cantidad: number;
        fuente: FuenteMovimientoStock;
        venta_id: number | null;
        reserva_consumo_id: number | null;
        observaciones: string | null;
        usuario_id: string;
        fecha_hora: string;
        productos: { nombre: string; linea: Linea } | null;
        usuarios: { nombre: string } | null;
      };

      return ((data ?? []) as unknown as Row[]).map((r) => ({
        id: r.id,
        producto_id: r.producto_id,
        producto_nombre: r.productos?.nombre ?? null,
        producto_linea: r.productos?.linea ?? null,
        cantidad: r.cantidad,
        fuente: r.fuente,
        venta_id: r.venta_id,
        reserva_consumo_id: r.reserva_consumo_id,
        observaciones: r.observaciones,
        usuario_id: r.usuario_id,
        usuario_nombre: r.usuarios?.nombre ?? null,
        fecha_hora: r.fecha_hora,
      }));
    },
  });
}
