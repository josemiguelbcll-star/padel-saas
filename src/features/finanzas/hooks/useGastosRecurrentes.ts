import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { useSession } from '@/features/auth';
import type { GastoRecurrente, TipoUnidad } from '@/types/database';
import { GASTOS_QUERY_KEY } from './useGastos';

export const GASTOS_RECURRENTES_QUERY_KEY = ['gastos-recurrentes'] as const;

/**
 * Fila enriquecida para el panel: la plantilla + datos del catálogo
 * (categoría, unidad, proveedor) + los gastos reales vinculados a
 * la plantilla (todos los históricos por simplicidad — el frontend
 * filtra por mes para detectar estado). El embed de gastos viene
 * acotado a los campos que el panel necesita.
 */
export interface RecurrenteFila {
  id: number;
  concepto: string;
  monto_estimado: number;
  dia_vencimiento: number;
  frecuencia: 'mensual';
  observaciones: string | null;
  activo: boolean;
  categoria_id: number;
  categoria_nombre: string;
  unidad_id: number;
  unidad_nombre: string;
  unidad_tipo: TipoUnidad;
  proveedor_id: number | null;
  proveedor_nombre: string | null;
  reales: ReadonlyArray<{
    id: number;
    monto: number;
    fecha_gasto: string;
    fecha_pago: string | null;
  }>;
}

/**
 * Lista de plantillas activas del club + sus gastos vinculados (todos
 * los históricos). El panel filtra por mes en frontend.
 *
 * Si una plantilla recibe muchos reales en el tiempo (24+ meses), el
 * embed crece linealmente — emerge como deuda cuando aplique, refactor
 * a RPC `fn_panel_recurrentes(p_anio, p_mes)` con conteos pre-agregados.
 *
 * Solo activas: las desactivadas no aparecen en el panel (sus reales
 * históricos conservan su `gasto_recurrente_id` y siguen apareciendo
 * en el historial de Movimientos).
 */
export function useGastosRecurrentes(): UseQueryResult<RecurrenteFila[], Error> {
  return useQuery<RecurrenteFila[], Error>({
    queryKey: GASTOS_RECURRENTES_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gastos_recurrentes')
        .select(
          `
          id, concepto, monto_estimado, dia_vencimiento, frecuencia,
          observaciones, activo,
          categoria_id, proveedor_id,
          categorias_gasto:categoria_id (
            id, nombre, unidad_id,
            unidades_negocio:unidad_id ( nombre, tipo )
          ),
          proveedores:proveedor_id ( nombre ),
          gastos!gastos_gasto_recurrente_id_fkey (
            id, monto, fecha_gasto, fecha_pago
          )
          `,
        )
        .eq('activo', true)
        .order('dia_vencimiento', { ascending: true })
        .order('concepto', { ascending: true });
      if (error) throw new Error(mapPostgrestError(error));

      type Row = {
        id: number;
        concepto: string;
        monto_estimado: number;
        dia_vencimiento: number;
        frecuencia: 'mensual';
        observaciones: string | null;
        activo: boolean;
        categoria_id: number;
        proveedor_id: number | null;
        categorias_gasto: {
          id: number;
          nombre: string;
          unidad_id: number;
          unidades_negocio: { nombre: string; tipo: TipoUnidad } | null;
        } | null;
        proveedores: { nombre: string } | null;
        gastos: Array<{
          id: number;
          monto: number;
          fecha_gasto: string;
          fecha_pago: string | null;
        }>;
      };

      return ((data ?? []) as unknown as Row[]).map((r) => ({
        id: r.id,
        concepto: r.concepto,
        monto_estimado: Number(r.monto_estimado),
        dia_vencimiento: r.dia_vencimiento,
        frecuencia: r.frecuencia,
        observaciones: r.observaciones,
        activo: r.activo,
        categoria_id: r.categoria_id,
        categoria_nombre: r.categorias_gasto?.nombre ?? '(eliminada)',
        unidad_id: r.categorias_gasto?.unidad_id ?? 0,
        unidad_nombre: r.categorias_gasto?.unidades_negocio?.nombre ?? '',
        unidad_tipo: (r.categorias_gasto?.unidades_negocio?.tipo ?? 'otro') as TipoUnidad,
        proveedor_id: r.proveedor_id,
        proveedor_nombre: r.proveedores?.nombre ?? null,
        reales: (r.gastos ?? []).map((g) => ({
          id: g.id,
          monto: Number(g.monto),
          fecha_gasto: g.fecha_gasto,
          fecha_pago: g.fecha_pago,
        })),
      }));
    },
  });
}

// ─── ABM ─────────────────────────────────────────────────────────────

export interface CrearRecurrenteInput {
  categoria_id: number;
  proveedor_id: number | null;
  concepto: string;
  monto_estimado: number;
  dia_vencimiento: number;
  observaciones: string | null;
}

/**
 * INSERT directo (sin RPC). RLS: solo admin del club.
 * UNIQUE (club_id, lower(concepto)) puede disparar 23505 si el admin
 * intenta crear "Luz" cuando ya existe (incluso si está desactivada).
 *
 * Setea `club_id` desde la sesión y `usuario_id` lo resuelve la
 * policy via auth.uid() — pero la columna es NOT NULL así que lo
 * mandamos explícito desde el SessionProvider (mismo patrón que
 * otros INSERTs directos del módulo).
 */
export function useCrearGastoRecurrente(): UseMutationResult<
  GastoRecurrente,
  Error,
  CrearRecurrenteInput
> {
  const queryClient = useQueryClient();
  const { club, user } = useSession();

  return useMutation<GastoRecurrente, Error, CrearRecurrenteInput>({
    mutationFn: async (input) => {
      if (!club || !user) {
        throw new Error(
          'No pudimos identificar tu club. Refrescá la página e intentá nuevamente.',
        );
      }
      const { data, error } = await supabase
        .from('gastos_recurrentes')
        .insert({
          club_id: club.id,
          categoria_id: input.categoria_id,
          proveedor_id: input.proveedor_id,
          concepto: input.concepto.trim(),
          monto_estimado: input.monto_estimado,
          dia_vencimiento: input.dia_vencimiento,
          frecuencia: 'mensual',
          observaciones: input.observaciones,
          activo: true,
          usuario_id: user.id,
        })
        .select('*')
        .single();
      if (error) throw new Error(mapPostgrestError(error));
      return data as GastoRecurrente;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: GASTOS_RECURRENTES_QUERY_KEY });
    },
  });
}

export interface ActualizarRecurrenteInput {
  id: number;
  changes: Partial<
    Pick<
      GastoRecurrente,
      | 'categoria_id'
      | 'proveedor_id'
      | 'concepto'
      | 'monto_estimado'
      | 'dia_vencimiento'
      | 'observaciones'
      | 'activo'
    >
  >;
}

/**
 * UPDATE directo. RLS: solo admin del club. Cubre tanto la edición
 * de metadata como el desactivar/reactivar (pasando `{ activo: ... }`).
 */
export function useActualizarGastoRecurrente(): UseMutationResult<
  GastoRecurrente,
  Error,
  ActualizarRecurrenteInput
> {
  const queryClient = useQueryClient();

  return useMutation<GastoRecurrente, Error, ActualizarRecurrenteInput>({
    mutationFn: async ({ id, changes }) => {
      const payload: Record<string, unknown> = {};
      if (changes.categoria_id !== undefined) payload.categoria_id = changes.categoria_id;
      if (changes.proveedor_id !== undefined) payload.proveedor_id = changes.proveedor_id;
      if (changes.concepto !== undefined) payload.concepto = changes.concepto.trim();
      if (changes.monto_estimado !== undefined) payload.monto_estimado = changes.monto_estimado;
      if (changes.dia_vencimiento !== undefined) payload.dia_vencimiento = changes.dia_vencimiento;
      if (changes.observaciones !== undefined) payload.observaciones = changes.observaciones;
      if (changes.activo !== undefined) payload.activo = changes.activo;

      const { data, error } = await supabase
        .from('gastos_recurrentes')
        .update(payload)
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw new Error(mapPostgrestError(error));
      return data as GastoRecurrente;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: GASTOS_RECURRENTES_QUERY_KEY });
      // La lista de Gastos puede mostrar el chip "🔁 Recurrente" — refrescar.
      void queryClient.invalidateQueries({ queryKey: GASTOS_QUERY_KEY });
    },
  });
}

/**
 * DELETE directo. RLS: solo admin del club. El ON DELETE SET NULL en
 * `gastos.gasto_recurrente_id` desliga los reales históricos sin
 * borrarlos. Si la plantilla todavía no generó reales, es un borrado
 * limpio.
 *
 * Mensaje de error posible (poco probable hoy): si en el futuro
 * agregamos un FK con RESTRICT desde otra tabla, vendría como 23503.
 */
export function useEliminarGastoRecurrente(): UseMutationResult<
  void,
  Error,
  number
> {
  const queryClient = useQueryClient();

  return useMutation<void, Error, number>({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('gastos_recurrentes')
        .delete()
        .eq('id', id);
      if (error) throw new Error(mapPostgrestError(error));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: GASTOS_RECURRENTES_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: GASTOS_QUERY_KEY });
    },
  });
}
