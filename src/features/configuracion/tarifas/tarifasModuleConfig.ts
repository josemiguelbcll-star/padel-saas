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
 * Las firmas de los hooks son idénticas entre turnos y clases porque
 * las dos tablas (`tarifas` y `tarifas_clases`) tienen la misma forma.
 * Si en el futuro divergen, separamos los tipos sin romper el patrón.
 */
export interface TarifasModuleConfig {
  modulo: TarifasModulo;
  useList: () => UseQueryResult<Tarifa[], Error>;
  useCrear: () => UseMutationResult<Tarifa, Error, CrearTarifaInput>;
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
  useList: useTarifas,
  useCrear: useCrearTarifa,
  useCambiarPrecio: useCambiarPrecioTarifa,
  useActualizarMetadata: useActualizarMetadataTarifa,
};

/**
 * Config del módulo "Clases" — alquiler de cancha al profesor para
 * clases. NO se cablea con fn_cobrar_clase todavía (eso es parte del
 * replanteo de Clases anotado en CLAUDE.md).
 */
export const tarifasClasesConfig: TarifasModuleConfig = {
  modulo: 'clases',
  useList: useTarifasClases,
  useCrear: useCrearTarifaClase,
  useCambiarPrecio: useCambiarPrecioTarifaClase,
  useActualizarMetadata: useActualizarMetadataTarifaClase,
};
