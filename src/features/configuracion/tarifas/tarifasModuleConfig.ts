import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import type { Tarifa } from '@/types/database';
import {
  useCambiarPrecioTarifa,
  useCrearTarifa,
  useTarifas,
  useActualizarMetadataTarifa,
  type ActualizarMetadataInput,
  type CambiarPrecioInput,
  type CrearTarifaInput,
} from '@/features/configuracion/hooks/useTarifas';
import {
  useCambiarPrecioTarifaClase,
  useCrearTarifaClase,
  useTarifasClases,
  useActualizarMetadataTarifaClase,
} from '@/features/configuracion/hooks/useTarifasClases';

/**
 * Tipo del "módulo" de tarifas — turnos o clases. Sirve para textos
 * contextuales en la UI y para telemetría / analytics.
 */
export type TarifasModulo = 'turnos' | 'clases';

/**
 * Bundle de hooks que define un "módulo de tarifas". El componente
 * TarifasPanel recibe una de estas instancias por prop y se vuelve
 * agnóstico de si está operando sobre tarifas de turnos o de clases.
 *
 * El identificador del profesor solo lo consume el módulo de clases;
 * los hooks de turnos ignoran ese contexto.
 */
export interface TarifasModuleConfig {
  modulo: TarifasModulo;
  useList: (profesorId?: number | null) => UseQueryResult<Tarifa[], Error>;
  useCrear: (
    profesorId?: number | null,
  ) => UseMutationResult<Tarifa, Error, CrearTarifaInput>;
  useCambiarPrecio: () => UseMutationResult<Tarifa, Error, CambiarPrecioInput>;
  useActualizarMetadata: () => UseMutationResult<
    number,
    Error,
    ActualizarMetadataInput
  >;
}

/** Config del módulo "Turnos" — tarifas de turnos sueltos / turnos fijos. */
export const tarifasTurnosConfig: TarifasModuleConfig = {
  modulo: 'turnos',
  useList: () => useTarifas(),
  useCrear: () => useCrearTarifa(),
  useCambiarPrecio: useCambiarPrecioTarifa,
  useActualizarMetadata: useActualizarMetadataTarifa,
};

/**
 * Config del módulo "Clases" — alquiler de cancha al profesor para
 * clases, resuelto por profesor, franja horaria y vigencia.
 */
export const tarifasClasesConfig: TarifasModuleConfig = {
  modulo: 'clases',
  useList: useTarifasClases,
  useCrear: useCrearTarifaClase,
  useCambiarPrecio: useCambiarPrecioTarifaClase,
  useActualizarMetadata: useActualizarMetadataTarifaClase,
};
