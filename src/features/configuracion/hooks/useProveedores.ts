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
import type { Proveedor } from '@/types/database';

export const PROVEEDORES_QUERY_KEY_BASE = 'proveedores';
export const PROVEEDORES_QUERY_KEY = [PROVEEDORES_QUERY_KEY_BASE] as const;

/**
 * Campos que el frontend envía al crear o actualizar. Omitimos `id` (DB),
 * `club_id` (sesión, RLS valida) y `fecha_alta` (DEFAULT NOW).
 *
 * Los opcionales son `string | null`: el frontend usa string en el state
 * y `sanitizeInput` convierte "" → null antes del insert/update (la DB
 * los espera nullable, NO empty string — preserva la distinción "no
 * cargado" en futuras consultas).
 */
export type ProveedorInput = Omit<Proveedor, 'id' | 'club_id' | 'fecha_alta'>;

/**
 * Normaliza los opcionales antes de mandar a Supabase: cualquier campo
 * que llegue como string vacío o solo espacios se convierte a null. El
 * `nombre` se trim-ea pero NO se vacía (lo valida zod aparte).
 *
 * Usar antes de cada `.insert(...)` y `.update(...)` (la conversión NO
 * vive en el schema zod porque depende del shape de la DB, no de la
 * validación lógica).
 */
function sanitizeInput<T extends Partial<ProveedorInput>>(input: T): T {
  const out: Record<string, unknown> = { ...input };
  // Trim + null-ificar los campos string opcionales.
  const stringOpcionales: ReadonlyArray<keyof ProveedorInput> = [
    'cuit',
    'contacto_persona',
    'contacto_telefono',
    'contacto_email',
    'condiciones_pago',
    'que_provee',
    'notas',
  ];
  for (const key of stringOpcionales) {
    const v = out[key];
    if (typeof v === 'string') {
      const trimmed = v.trim();
      out[key] = trimmed === '' ? null : trimmed;
    }
  }
  if (typeof out.nombre === 'string') {
    out.nombre = out.nombre.trim();
  }
  return out as T;
}

/**
 * Lista de proveedores del club. Devuelve activos e inactivos; el
 * consumidor filtra a gusto (la pantalla usa un toggle "Mostrar
 * inactivos" — default off).
 *
 * Orden: activos primero, después por nombre asc (case-insensitive a
 * nivel SQL no es trivial sin función; el orden por nombre alcanza
 * para una lista de ~decenas de proveedores).
 */
export function useProveedores(): UseQueryResult<Proveedor[], Error> {
  return useQuery<Proveedor[], Error>({
    queryKey: PROVEEDORES_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('proveedores')
        .select('*')
        .order('activo', { ascending: false })
        .order('nombre', { ascending: true });
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as Proveedor[];
    },
  });
}

export function useCreateProveedor(): UseMutationResult<
  Proveedor,
  Error,
  ProveedorInput
> {
  const queryClient = useQueryClient();
  const { club } = useSession();

  return useMutation<Proveedor, Error, ProveedorInput>({
    mutationFn: async (input) => {
      if (!club) {
        throw new Error(
          'No pudimos identificar tu club. Refrescá la página e intentá nuevamente.',
        );
      }
      const payload = sanitizeInput(input);
      const { data, error } = await supabase
        .from('proveedores')
        .insert({ ...payload, club_id: club.id })
        .select()
        .single();
      // UNIQUE funcional sobre (club_id, lower(nombre)) → SQLSTATE 23505.
      // mapPostgrestError lo traduce a "Ya existe un registro con esos
      // datos." y la UI lo muestra tal cual.
      if (error) throw new Error(mapPostgrestError(error));
      return data as Proveedor;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROVEEDORES_QUERY_KEY });
    },
  });
}

interface UpdateProveedorArgs {
  id: number;
  changes: Partial<ProveedorInput>;
}

/**
 * Actualizar un proveedor. Sirve para:
 *   - Editar metadata (cualquier campo del form).
 *   - Desactivar/Reactivar (pasando `{ activo: false }` o `true`).
 *
 * NO hay `useDeleteProveedor`: el soft-delete vía `activo` es la única
 * UX expuesta. La policy DELETE existe en DB para coherencia con
 * productos, pero el frontend no la usa hasta que aparezca la tabla
 * `compras` + trigger anti-DELETE.
 */
export function useUpdateProveedor(): UseMutationResult<
  Proveedor,
  Error,
  UpdateProveedorArgs
> {
  const queryClient = useQueryClient();

  return useMutation<Proveedor, Error, UpdateProveedorArgs>({
    mutationFn: async ({ id, changes }) => {
      const payload = sanitizeInput(changes);
      const { data, error } = await supabase
        .from('proveedores')
        .update(payload)
        .eq('id', id)
        .select()
        .single();
      if (error) throw new Error(mapPostgrestError(error));
      return data as Proveedor;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROVEEDORES_QUERY_KEY });
    },
  });
}
