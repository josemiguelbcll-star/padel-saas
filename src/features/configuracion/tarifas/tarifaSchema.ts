import { z } from 'zod';

/**
 * Schema de una tarifa tal como la modela la migración 0003.
 *
 * El form la maneja con strings para `monto` y `prioridad` (porque los
 * `<input>` siempre dan strings) y los coerciona acá con z.coerce.
 *
 * Las cláusulas refine() replican los CHECK constraints de Postgres:
 *   - desde_hora y hasta_hora: ambos null o ambos seteados con
 *     hasta_hora > desde_hora.
 *   - dias_semana: null (aplica a todos los días) o array no vacío de
 *     valores entre 1 y 7.
 *
 * Defensa en profundidad: si por algún motivo el frontend manda algo
 * que viole las reglas, igual lo rechaza Postgres por CHECK; pero acá
 * damos el mensaje en castellano antes de tocar la red.
 */
export const tarifaSchema = z
  .object({
    nombre: z
      .string()
      .trim()
      .min(1, 'El nombre es obligatorio.')
      .max(80, 'El nombre no puede tener más de 80 caracteres.'),
    monto: z.coerce
      .number({ invalid_type_error: 'Ingresá un monto válido.' })
      .min(0, 'El monto debe ser mayor o igual a 0.'),
    desde_hora: z
      .string()
      .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Formato horario inválido (HH:MM).')
      .nullable(),
    hasta_hora: z
      .string()
      .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Formato horario inválido (HH:MM).')
      .nullable(),
    dias_semana: z
      .array(z.number().int().min(1).max(7))
      .nullable()
      .refine((arr) => arr === null || arr.length > 0, {
        message: 'Seleccioná al menos un día.',
      }),
    prioridad: z.coerce
      .number({ invalid_type_error: 'La prioridad debe ser un número.' })
      .int('La prioridad debe ser un número entero.')
      .min(0, 'La prioridad debe ser mayor o igual a 0.'),
    activa: z.boolean(),
  })
  .refine(
    (data) => (data.desde_hora === null) === (data.hasta_hora === null),
    {
      message: 'Si configurás una franja, completá ambas horas.',
      path: ['hasta_hora'],
    },
  )
  .refine(
    (data) => {
      if (data.desde_hora === null || data.hasta_hora === null) return true;
      return data.hasta_hora > data.desde_hora;
    },
    {
      message: '"Hasta" tiene que ser posterior a "desde".',
      path: ['hasta_hora'],
    },
  );

export type TarifaFormValues = z.output<typeof tarifaSchema>;
