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
import type { ClaseAlumnoFijo, ClaseOcurrenciaAlumno } from '@/types/database';

export const CLASE_ALUMNOS_QUERY_KEY_BASE = 'clase_ocurrencia_alumnos';
export const CLASE_ALUMNOS_FIJOS_QUERY_KEY_BASE = 'clase_alumnos_fijos';

export function claseAlumnosQueryKey(claseId: number, fecha: string) {
  return [CLASE_ALUMNOS_QUERY_KEY_BASE, claseId, fecha] as const;
}

export function claseAlumnosFijosQueryKey(claseId: number) {
  return [CLASE_ALUMNOS_FIJOS_QUERY_KEY_BASE, claseId] as const;
}

export interface AlumnoClaseConDatos extends ClaseOcurrenciaAlumno {
  jugador_nombre?: string;
}

/**
 * Consulta y sincroniza los alumnos de una clase en una fecha puntual.
 * Si no existen registros para esa fecha, copia automáticamente los
 * alumnos fijos semanales configurados para esa clase (si los hay).
 */
export function useClaseAlumnos(
  claseId: number | null,
  fecha: string | null,
): UseQueryResult<ClaseOcurrenciaAlumno[], Error> {
  const { club } = useSession();

  return useQuery<ClaseOcurrenciaAlumno[], Error>({
    queryKey: claseId !== null && fecha !== null
      ? claseAlumnosQueryKey(claseId, fecha)
      : [CLASE_ALUMNOS_QUERY_KEY_BASE],
    queryFn: async () => {
      if (claseId === null || fecha === null || !club?.id) return [];

      // 1. Buscar alumnos de la ocurrencia
      const { data: alumnos, error } = await supabase
        .from('clase_ocurrencia_alumnos')
        .select('*, jugador:jugador_id(id, nombre, telefono, email)')
        .eq('clase_id', claseId)
        .eq('fecha', fecha)
        .order('id', { ascending: true });

      if (error) throw new Error(mapPostgrestError(error));

      if (alumnos && alumnos.length > 0) {
        return alumnos as ClaseOcurrenciaAlumno[];
      }

      // 2. Si no hay alumnos cargados aún para esta fecha, revisar si hay alumnos fijos semanales
      const { data: fijos, error: errFijos } = await supabase
        .from('clase_alumnos_fijos')
        .select('*')
        .eq('clase_id', claseId);

      if (errFijos) throw new Error(mapPostgrestError(errFijos));

      if (fijos && fijos.length > 0) {
        // Copiar alumnos fijos a la ocurrencia puntual
        const nuevos = fijos.map((f: ClaseAlumnoFijo) => ({
          club_id: club.id,
          clase_id: claseId,
          fecha,
          jugador_id: f.jugador_id,
          nombre_libre: f.nombre_libre,
          monto_clase: f.monto_cuota ?? 0,
          cuota_fija: f.monto_cuota,
        }));

        const { data: insertados, error: errIns } = await supabase
          .from('clase_ocurrencia_alumnos')
          .insert(nuevos)
          .select('*, jugador:jugador_id(id, nombre, telefono, email)');

        if (errIns) throw new Error(mapPostgrestError(errIns));
        return (insertados ?? []) as ClaseOcurrenciaAlumno[];
      }

      return [];
    },
    enabled: claseId !== null && fecha !== null && !!club?.id,
  });
}

export interface AgregarAlumnoClaseInput {
  clase_id: number;
  fecha: string;
  jugador_id: number | null;
  nombre_libre: string | null;
  monto_clase?: number;
  cuota_fija?: number | null;
}

export function useAgregarAlumnoClase(): UseMutationResult<
  ClaseOcurrenciaAlumno,
  Error,
  AgregarAlumnoClaseInput
> {
  const queryClient = useQueryClient();
  const { club } = useSession();

  return useMutation({
    mutationFn: async (input) => {
      if (!club?.id) throw new Error('No hay club seleccionado.');

      const { data, error } = await supabase
        .from('clase_ocurrencia_alumnos')
        .insert({
          club_id: club.id,
          clase_id: input.clase_id,
          fecha: input.fecha,
          jugador_id: input.jugador_id,
          nombre_libre: input.nombre_libre,
          monto_clase: input.monto_clase ?? 0,
          cuota_fija: input.cuota_fija ?? null,
        })
        .select('*, jugador:jugador_id(id, nombre, telefono, email)')
        .single();

      if (error) throw new Error(mapPostgrestError(error));
      return data as ClaseOcurrenciaAlumno;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({
        queryKey: claseAlumnosQueryKey(data.clase_id, data.fecha),
      });
    },
  });
}

export interface ActualizarAlumnoClaseInput {
  id: number;
  clase_id: number;
  fecha: string;
  monto_clase?: number;
  cuota_fija?: number | null;
  nombre_libre?: string | null;
}

export function useActualizarAlumnoClase(): UseMutationResult<
  ClaseOcurrenciaAlumno,
  Error,
  ActualizarAlumnoClaseInput
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input) => {
      const updates: Partial<ClaseOcurrenciaAlumno> = {};
      if (input.monto_clase !== undefined) updates.monto_clase = input.monto_clase;
      if (input.cuota_fija !== undefined) updates.cuota_fija = input.cuota_fija;
      if (input.nombre_libre !== undefined) updates.nombre_libre = input.nombre_libre;

      const { data, error } = await supabase
        .from('clase_ocurrencia_alumnos')
        .update(updates)
        .eq('id', input.id)
        .select('*, jugador:jugador_id(id, nombre, telefono, email)')
        .single();

      if (error) throw new Error(mapPostgrestError(error));
      return data as ClaseOcurrenciaAlumno;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({
        queryKey: claseAlumnosQueryKey(data.clase_id, data.fecha),
      });
    },
  });
}

export interface QuitarAlumnoClaseInput {
  id: number;
  clase_id: number;
  fecha: string;
}

export function useQuitarAlumnoClase(): UseMutationResult<
  void,
  Error,
  QuitarAlumnoClaseInput
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input) => {
      const { error } = await supabase
        .from('clase_ocurrencia_alumnos')
        .delete()
        .eq('id', input.id);

      if (error) throw new Error(mapPostgrestError(error));
    },
    onSuccess: (_, input) => {
      void queryClient.invalidateQueries({
        queryKey: claseAlumnosQueryKey(input.clase_id, input.fecha),
      });
    },
  });
}

/**
 * Guarda los alumnos actuales de una ocurrencia como los alumnos fijos
 * semanales de la clase para que aparezcan automáticamente cada semana.
 */
export function useGuardarComoAlumnosFijos(): UseMutationResult<
  void,
  Error,
  { clase_id: number; alumnos: ClaseOcurrenciaAlumno[] }
> {
  const queryClient = useQueryClient();
  const { club } = useSession();

  return useMutation({
    mutationFn: async ({ clase_id, alumnos }) => {
      if (!club?.id) throw new Error('No hay club seleccionado.');

      // 1. Eliminar fijos existentes para esta clase
      const { error: errDel } = await supabase
        .from('clase_alumnos_fijos')
        .delete()
        .eq('clase_id', clase_id);

      if (errDel) throw new Error(mapPostgrestError(errDel));

      // 2. Insertar fijos nuevos
      if (alumnos.length > 0) {
        const fijos = alumnos.map((a) => ({
          club_id: club.id,
          clase_id,
          jugador_id: a.jugador_id,
          nombre_libre: a.nombre_libre,
          monto_cuota: a.cuota_fija ?? a.monto_clase,
        }));

        const { error: errIns } = await supabase
          .from('clase_alumnos_fijos')
          .insert(fijos);

        if (errIns) throw new Error(mapPostgrestError(errIns));
      }
    },
    onSuccess: (_, { clase_id }) => {
      void queryClient.invalidateQueries({
        queryKey: claseAlumnosFijosQueryKey(clase_id),
      });
    },
  });
}
