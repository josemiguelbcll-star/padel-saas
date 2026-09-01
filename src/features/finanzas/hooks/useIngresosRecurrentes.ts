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
import type { IngresoRecurrente, TipoUnidad } from '@/types/database';
import { OTROS_INGRESOS_QUERY_KEY } from './useOtrosIngresos';

export const INGRESOS_RECURRENTES_QUERY_KEY = ['ingresos-recurrentes'] as const;

export interface IngresoRecurrenteFila {
  id: number;
  concepto: string;
  monto_estimado: number;
  dia_vencimiento: number;
  frecuencia: 'mensual';
  observaciones: string | null;
  activo: boolean;
  unidad_id: number;
  unidad_nombre: string;
  unidad_tipo: TipoUnidad;
  reales: ReadonlyArray<{
    id: number;
    monto: number;
    fecha: string;
    fecha_cobro: string | null;
  }>;
}

export function useIngresosRecurrentes(): UseQueryResult<IngresoRecurrenteFila[], Error> {
  return useQuery<IngresoRecurrenteFila[], Error>({
    queryKey: INGRESOS_RECURRENTES_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ingresos_recurrentes')
        .select(
          `
          id, concepto, monto_estimado, dia_vencimiento, frecuencia,
          observaciones, activo, unidad_id,
          unidades_negocio:unidad_id ( nombre, tipo ),
          otros_ingresos!otros_ingresos_ingreso_recurrente_id_fkey (
            id, monto, fecha, fecha_cobro, activo
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
        unidad_id: number;
        unidades_negocio: { nombre: string; tipo: TipoUnidad } | null;
        otros_ingresos: Array<{
          id: number;
          monto: number;
          fecha: string;
          fecha_cobro: string | null;
          activo: boolean;
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
        unidad_id: r.unidad_id,
        unidad_nombre: r.unidades_negocio?.nombre ?? '(eliminada)',
        unidad_tipo: r.unidades_negocio?.tipo ?? 'otro',
        reales: (r.otros_ingresos ?? [])
          .filter((i) => i.activo)
          .map((i) => ({
            id: i.id,
            monto: Number(i.monto),
            fecha: i.fecha,
            fecha_cobro: i.fecha_cobro,
          })),
      }));
    },
  });
}

export interface CrearIngresoRecurrenteInput {
  unidad_id: number;
  concepto: string;
  monto_estimado: number;
  dia_vencimiento: number;
  observaciones?: string | null;
}

export function useCrearIngresoRecurrente(): UseMutationResult<
  IngresoRecurrente,
  Error,
  CrearIngresoRecurrenteInput
> {
  const queryClient = useQueryClient();
  const { user } = useSession();

  return useMutation<IngresoRecurrente, Error, CrearIngresoRecurrenteInput>({
    mutationFn: async (input) => {
      if (!user?.club_id || !user.id) {
        throw new Error('No hay sesión activa.');
      }
      const { data, error } = await supabase
        .from('ingresos_recurrentes')
        .insert({
          club_id: user.club_id,
          unidad_id: input.unidad_id,
          concepto: input.concepto.trim(),
          monto_estimado: input.monto_estimado,
          dia_vencimiento: input.dia_vencimiento,
          frecuencia: 'mensual',
          observaciones: input.observaciones ? input.observaciones.trim() : null,
          usuario_id: user.id,
        })
        .select()
        .single();
      if (error) throw new Error(mapPostgrestError(error));
      return data as IngresoRecurrente;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: INGRESOS_RECURRENTES_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: OTROS_INGRESOS_QUERY_KEY });
    },
  });
}

export interface ActualizarIngresoRecurrenteInput {
  id: number;
  unidad_id: number;
  concepto: string;
  monto_estimado: number;
  dia_vencimiento: number;
  observaciones?: string | null;
}

export function useActualizarIngresoRecurrente(): UseMutationResult<
  IngresoRecurrente,
  Error,
  ActualizarIngresoRecurrenteInput
> {
  const queryClient = useQueryClient();

  return useMutation<IngresoRecurrente, Error, ActualizarIngresoRecurrenteInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase
        .from('ingresos_recurrentes')
        .update({
          unidad_id: input.unidad_id,
          concepto: input.concepto.trim(),
          monto_estimado: input.monto_estimado,
          dia_vencimiento: input.dia_vencimiento,
          observaciones: input.observaciones ? input.observaciones.trim() : null,
        })
        .eq('id', input.id)
        .select()
        .single();
      if (error) throw new Error(mapPostgrestError(error));
      return data as IngresoRecurrente;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: INGRESOS_RECURRENTES_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: OTROS_INGRESOS_QUERY_KEY });
    },
  });
}

export function useDesactivarIngresoRecurrente(): UseMutationResult<
  void,
  Error,
  number
> {
  const queryClient = useQueryClient();

  return useMutation<void, Error, number>({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('ingresos_recurrentes')
        .update({ activo: false })
        .eq('id', id);
      if (error) throw new Error(mapPostgrestError(error));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: INGRESOS_RECURRENTES_QUERY_KEY });
    },
  });
}
