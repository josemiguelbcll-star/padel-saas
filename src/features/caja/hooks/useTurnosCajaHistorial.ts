import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { useSession } from '@/features/auth';
import type { TurnoCaja } from '@/types/database';

export interface SiguienteTurnoInfo {
  id: number;
  fecha_jornada: string;
  abierta_en: string;
  monto_apertura: number;
  usuarioAperturaNombre: string;
}

export interface TurnoCajaConDetalles extends TurnoCaja {
  usuarioAperturaNombre: string;
  usuarioCierreNombre: string | null;
  vendedorNombre: string | null;
  /** Siguiente turno que se abrió cronológicamente después de este */
  siguienteTurno: SiguienteTurnoInfo | null;
  /** Monto con el que arrancó la siguiente caja abierta */
  fondoDejadoParaProxima: number | null;
  /** Diferencia entre lo que se contó al cierre y lo que se usó al abrir la siguiente caja */
  diferenciaConProximaApertura: number | null;
}

export const TURNOS_CAJA_HISTORIAL_QUERY_KEY = (clubId?: number) =>
  ['caja', 'turnos-historial', clubId] as const;

/**
 * Consulta el historial completo de jornadas / turnos de caja del club
 * (aperturas, cierres, arqueos, importes contados vs esperados y usuarios intervinientes).
 *
 * Además calcula la continuidad entre cierres y la apertura siguiente
 * para auditar si el fondo de caja coincidió al abrir nuevamente la jornada.
 */
export function useTurnosCajaHistorial(): UseQueryResult<
  TurnoCajaConDetalles[],
  Error
> {
  const { club } = useSession();

  return useQuery<TurnoCajaConDetalles[], Error>({
    queryKey: TURNOS_CAJA_HISTORIAL_QUERY_KEY(club?.id),
    enabled: !!club,
    staleTime: 10_000,
    queryFn: async () => {
      if (!club) throw new Error('No pudimos identificar tu club.');

      const [turnosRes, usuariosRes] = await Promise.all([
        supabase
          .from('turnos_caja')
          .select('*')
          .eq('club_id', club.id)
          .order('abierta_en', { ascending: false }),
        supabase
          .from('usuarios')
          .select('id, nombre, email, rol')
          .eq('club_id', club.id),
      ]);

      if (turnosRes.error) throw new Error(mapPostgrestError(turnosRes.error));
      if (usuariosRes.error) throw new Error(mapPostgrestError(usuariosRes.error));

      const usersMap = new Map<string, string>();
      for (const u of usuariosRes.data ?? []) {
        usersMap.set(u.id, u.nombre?.trim() || u.email || 'Usuario');
      }

      const turnosRaw = (turnosRes.data ?? []) as TurnoCaja[];

      // turnosRaw viene en orden DESC por abierta_en (el más reciente primero).
      // Por ende, la caja inmediatamente posterior cronológica a `idx` está en `idx - 1`.
      const resultado: TurnoCajaConDetalles[] = turnosRaw.map((t, idx) => {
        const uApertura =
          usersMap.get(t.usuario_apertura) || 'Usuario desconocido';
        const uCierre = t.usuario_cierre
          ? usersMap.get(t.usuario_cierre) || 'Usuario desconocido'
          : null;
        const uVendedor = t.vendedor_id
          ? usersMap.get(t.vendedor_id) || null
          : null;

        const sig = idx > 0 ? turnosRaw[idx - 1] : null;
        const siguienteTurno: SiguienteTurnoInfo | null = sig
          ? {
              id: sig.id,
              fecha_jornada: sig.fecha_jornada,
              abierta_en: sig.abierta_en,
              monto_apertura: Number(sig.monto_apertura),
              usuarioAperturaNombre:
                usersMap.get(sig.usuario_apertura) || 'Usuario',
            }
          : null;

        const fondoDejadoParaProxima = siguienteTurno
          ? siguienteTurno.monto_apertura
          : null;

        const diferenciaConProximaApertura =
          t.efectivo_contado !== null && siguienteTurno
            ? Number(
                (
                  siguienteTurno.monto_apertura - Number(t.efectivo_contado)
                ).toFixed(2),
              )
            : null;

        return {
          ...t,
          monto_apertura: Number(t.monto_apertura),
          efectivo_esperado:
            t.efectivo_esperado !== null ? Number(t.efectivo_esperado) : null,
          efectivo_contado:
            t.efectivo_contado !== null ? Number(t.efectivo_contado) : null,
          diferencia: t.diferencia !== null ? Number(t.diferencia) : null,
          usuarioAperturaNombre: uApertura,
          usuarioCierreNombre: uCierre,
          vendedorNombre: uVendedor,
          siguienteTurno,
          fondoDejadoParaProxima,
          diferenciaConProximaApertura,
        };
      });

      return resultado;
    },
  });
}
