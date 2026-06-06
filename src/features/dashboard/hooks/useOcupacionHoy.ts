import { useMemo } from 'react';
import { useCanchas } from '@/features/configuracion/hooks/useCanchas';
import { useClases } from '@/features/configuracion/hooks/useClases';
import { useHorariosClub } from '@/features/configuracion/hooks/useHorariosClub';
import { useReservasDelDia } from '@/features/reservas/hooks/useReservasDelDia';
import { diaSemanaDe, fechaHoy } from '@/features/reservas/utils/fechaUtils';
import { calcularOcupacion, type ResultadoOcupacion } from '../utils/kpisHoy';

export interface OcupacionHoy {
  /** null mientras alguna de las 4 queries carga. */
  resultado: ResultadoOcupacion | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * % de ocupación de canchas hoy. Combina 4 queries existentes (reservas del
 * día + catálogo de clases + canchas + horarios del club) y delega el cómputo
 * a la función pura `calcularOcupacion`.
 *
 * Las 4 queries comparten cache con el resto de la app (React Query dedupe por
 * queryKey), así que no agregan round-trips si ya están en memoria.
 */
export function useOcupacionHoy(): OcupacionHoy {
  const hoy = fechaHoy();
  const reservasQ = useReservasDelDia(hoy);
  const clasesQ = useClases();
  const canchasQ = useCanchas();
  const horariosQ = useHorariosClub();

  const resultado = useMemo<ResultadoOcupacion | null>(() => {
    if (!reservasQ.data || !clasesQ.data || !canchasQ.data || !horariosQ.data) {
      return null;
    }
    const canchasActivas = canchasQ.data.filter((c) => c.activa).length;
    return calcularOcupacion({
      reservas: reservasQ.data,
      clases: clasesQ.data,
      diaSemana: diaSemanaDe(hoy),
      horaApertura: horariosQ.data.hora_apertura,
      horaCierre: horariosQ.data.hora_cierre,
      canchasActivas,
    });
  }, [reservasQ.data, clasesQ.data, canchasQ.data, horariosQ.data, hoy]);

  return {
    resultado,
    isLoading:
      reservasQ.isLoading ||
      clasesQ.isLoading ||
      canchasQ.isLoading ||
      horariosQ.isLoading,
    error:
      reservasQ.error ??
      clasesQ.error ??
      canchasQ.error ??
      horariosQ.error ??
      null,
  };
}
