import { z } from 'zod';

/**
 * Schema de validación de una cancha tal como la modela la migración 0003.
 *
 * Nota sobre `tipo`:
 *   El formulario siempre entrega un string (el `<input>`). Acá usamos
 *   transform() para convertir string vacío → null antes de mandar al
 *   backend, así la DB guarda NULL cuando el admin no especifica tipo.
 *   Eso hace que z.input != z.output para este schema: la UI maneja
 *   `string`, la DB recibe `string | null`.
 */
export const canchaSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, 'El nombre es obligatorio.')
    .max(60, 'El nombre no puede tener más de 60 caracteres.'),
  tipo: z
    .string()
    .max(40, 'El tipo no puede tener más de 40 caracteres.')
    .transform((v) => v.trim())
    .transform((v) => (v === '' ? null : v)),
  cubierta: z.boolean(),
  activa: z.boolean(),
  orden: z
    .number({ invalid_type_error: 'El orden debe ser un número.' })
    .int('El orden debe ser un número entero.')
    .min(0, 'El orden debe ser mayor o igual a 0.'),
});

/** Lo que el formulario maneja en estado local (tipo como string). */
export type CanchaFormState = z.input<typeof canchaSchema>;
/** Lo que sale del schema validado (tipo como string | null). */
export type CanchaFormValues = z.output<typeof canchaSchema>;
