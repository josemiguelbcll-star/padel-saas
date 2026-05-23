import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { Tarifa, TurnoFijo } from '@/types/database';
import type { ClaseConProfesor } from '@/features/configuracion/hooks/useClases';
import {
  calcularProyeccionTurnosFijos,
  calcularProyeccionReservasSueltas,
  type ReservaMinima,
  type ProyeccionPorOrigen,
} from '../utils/calcularProyeccionTurnosFijos';
import {
  calcularProyeccionClases,
  type CobroClaseMinimo,
} from '../utils/calcularProyeccionClases';
import { rangoMesISO } from '../utils/ocurrenciasDelMes';

export interface ProyeccionAlquileres {
  anio: number;
  mes: number;
  ya_cobrado_total: number;
  falta_cobrar_total: number;
  total_estimado: number;
  /** Desglose por origen (turnos fijos / clases / reservas sueltas). */
  desglose: {
    turnos_fijos: ProyeccionPorOrigen;
    clases: ProyeccionPorOrigen;
    reservas_sueltas: ProyeccionPorOrigen;
  };
}

export const PROYECCION_ALQUILERES_QUERY_KEY = (anio: number, mes: number) =>
  ['proyeccion_alquileres', anio, mes] as const;

/**
 * Proyección DEVENGADA de alquileres del mes (turnos fijos + clases +
 * reservas sueltas). NO usa criterio caja — cada reserva/ocurrencia
 * cuenta como ingreso del mes que le corresponde, sin importar cuándo
 * entra la plata.
 *
 * 6 queries paralelas (turnos fijos, reservas del mes, tarifas turnos,
 * clases, clase_cobros del mes, tarifas clases). Calcula client-side
 * con funciones puras (`calcularProyeccion*`). Cero escrituras.
 *
 * El criterio anti-doble-conteo está en las funciones puras: cada
 * unidad (reserva, ocurrencia de turno fijo, par clase-fecha) entra
 * una sola vez en una sola columna.
 *
 * Las reservas canceladas se EXCLUYEN del cálculo (decisión del Punto 3,
 * limitación documentada: una seña no devuelta de una cancelada queda
 * fuera; refinar en iteración futura si emerge la necesidad).
 */
export function useProyeccionAlquileres(
  anio: number,
  mes: number,
): UseQueryResult<ProyeccionAlquileres, Error> {
  return useQuery<ProyeccionAlquileres, Error>({
    queryKey: PROYECCION_ALQUILERES_QUERY_KEY(anio, mes),
    queryFn: async () => {
      const { desde, hasta } = rangoMesISO(anio, mes);

      // 6 queries en paralelo. La RLS filtra por club; las firmas
      // espejo client-side (resolverTarifa) usan los mismos datos que
      // veríamos llamando fn_resolver_tarifa / fn_resolver_tarifa_clase.
      const [
        turnosFijosRes,
        reservasRes,
        tarifasRes,
        clasesRes,
        cobrosRes,
        tarifasClasesRes,
      ] = await Promise.all([
        supabase
          .from('turnos_fijos')
          .select(
            'id, club_id, cancha_id, jugador_id, nombre_libre, dia_semana, hora_inicio, duracion_min, fecha_desde, fecha_hasta, activo, observaciones, usuario_alta_id, fecha_alta',
          )
          .eq('activo', true),
        supabase
          .from('reservas')
          .select('id, turno_fijo_id, fecha, estado, monto_total, monto_pagado')
          .gte('fecha', desde)
          .lte('fecha', hasta),
        supabase.from('tarifas').select('*'),
        supabase
          .from('clases')
          .select('*, profesor:profesor_id(nombre)')
          .eq('activa', true),
        supabase
          .from('clase_cobros')
          .select('clase_id, fecha, monto')
          .gte('fecha', desde)
          .lte('fecha', hasta),
        supabase.from('tarifas_clases').select('*'),
      ]);

      for (const r of [
        turnosFijosRes,
        reservasRes,
        tarifasRes,
        clasesRes,
        cobrosRes,
        tarifasClasesRes,
      ]) {
        if (r.error) throw new Error(mapPostgrestError(r.error));
      }

      const turnosFijos = (turnosFijosRes.data ?? []) as TurnoFijo[];
      const reservas = (reservasRes.data ?? []) as ReservaMinima[];
      const tarifas = (tarifasRes.data ?? []) as Tarifa[];
      const clases = (clasesRes.data ?? []) as unknown as ClaseConProfesor[];
      const cobros = (cobrosRes.data ?? []) as CobroClaseMinimo[];
      const tarifasClases = (tarifasClasesRes.data ?? []) as Tarifa[];

      const turnosFijosResult = calcularProyeccionTurnosFijos({
        anio,
        mes,
        turnosFijos,
        reservasDelMes: reservas,
        tarifas,
      });

      const clasesResult = calcularProyeccionClases({
        anio,
        mes,
        clases,
        cobrosDelMes: cobros,
        tarifasClases,
      });

      const reservasSueltasResult = calcularProyeccionReservasSueltas(reservas);

      const ya_cobrado_total =
        turnosFijosResult.ya_cobrado +
        clasesResult.ya_cobrado +
        reservasSueltasResult.ya_cobrado;
      const falta_cobrar_total =
        turnosFijosResult.falta_cobrar +
        clasesResult.falta_cobrar +
        reservasSueltasResult.falta_cobrar;

      return {
        anio,
        mes,
        ya_cobrado_total,
        falta_cobrar_total,
        total_estimado: ya_cobrado_total + falta_cobrar_total,
        desglose: {
          turnos_fijos: turnosFijosResult,
          clases: clasesResult,
          reservas_sueltas: reservasSueltasResult,
        },
      };
    },
  });
}
