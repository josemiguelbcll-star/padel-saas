import type { MedioPago } from '@/types/database';

/** Medio de pago sin la variante 'mixto' (que solo existe a nivel venta). */
export type MedioPagoSinMixto = Exclude<MedioPago, 'mixto'>;

/**
 * Deriva el medio de pago desde el tipo de una cuenta del club.
 * Es la regla inversa del modelo "medio = cómo pagó, cuenta = dónde quedó":
 * al elegir una cuenta explícita, el medio se deduce de su tipo.
 */
export function mapCuentaTipoToMedio(tipo: string): MedioPagoSinMixto {
  if (tipo === 'efectivo') return 'efectivo';
  if (tipo === 'billetera') return 'mp';
  if (tipo === 'banco') return 'transferencia';
  return 'otro';
}
