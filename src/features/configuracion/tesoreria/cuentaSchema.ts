import { z } from 'zod';
import type { TipoCuenta } from '@/types/database';

/** Opciones de tipo de cuenta (value = enum DB, label = UI). */
export const TIPOS_CUENTA: ReadonlyArray<{ value: TipoCuenta; label: string }> = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'banco', label: 'Banco' },
  { value: 'billetera', label: 'Billetera virtual' },
  { value: 'otro', label: 'Otro' },
];

/**
 * Validación del form de cuenta. Coincide con la tabla `cuentas` (0056):
 *   - nombre 1-80, obligatorio. UNIQUE (club_id, nombre) server-side → si
 *     choca, llega 23505 mapeado.
 *   - saldo_inicial: número (permite negativo — una cuenta bancaria puede
 *     estar en descubierto). El input vacío coerce a 0.
 *   - detalle (CBU/alias) opcional. orden entero >= 0.
 */
export const cuentaSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, 'El nombre es obligatorio.')
    .max(80, 'El nombre no puede tener más de 80 caracteres.'),
  tipo: z.enum(['efectivo', 'banco', 'billetera', 'otro'], {
    errorMap: () => ({ message: 'Elegí un tipo de cuenta.' }),
  }),
  saldo_inicial: z.coerce
    .number({ invalid_type_error: 'El saldo inicial debe ser un número.' })
    .finite('El saldo inicial es inválido.'),
  detalle: z
    .string()
    .trim()
    .max(120, 'El detalle no puede tener más de 120 caracteres.')
    .optional()
    .default(''),
  es_caja_fisica: z.boolean(),
  orden: z.coerce
    .number({ invalid_type_error: 'El orden debe ser un número.' })
    .int('El orden debe ser un entero.')
    .min(0, 'El orden no puede ser negativo.'),
  activa: z.boolean(),
});

/** Estado local del form (numéricos como string para los inputs). */
export interface CuentaFormState {
  nombre: string;
  tipo: TipoCuenta;
  saldo_inicial: string;
  detalle: string;
  es_caja_fisica: boolean;
  orden: string;
  activa: boolean;
}

export type CuentaFormValues = z.output<typeof cuentaSchema>;
