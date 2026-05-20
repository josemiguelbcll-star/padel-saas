import { z } from 'zod';

/**
 * Schema de un profesor tal como lo modela la migración 0005.
 *
 * Sólo `nombre` es obligatorio. Para los campos opcionales usamos
 * transform() para mapear empty string → null antes de mandar al
 * backend (la DB guarda NULL cuando no se especifica). Esto hace que
 * z.input ≠ z.output: la UI maneja `string` (el `<input>`), la DB
 * recibe `string | null`.
 */
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const profesorSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, 'El nombre es obligatorio.')
    .max(120, 'El nombre no puede tener más de 120 caracteres.'),
  telefono: z
    .string()
    .max(40, 'El teléfono no puede tener más de 40 caracteres.')
    .transform((v) => v.trim())
    .transform((v) => (v === '' ? null : v)),
  email: z
    .string()
    .max(120, 'El email no puede tener más de 120 caracteres.')
    .transform((v) => v.trim())
    .transform((v) => (v === '' ? null : v))
    .refine((v) => v === null || emailRegex.test(v), {
      message: 'Ingresá un email válido.',
    }),
  notas: z
    .string()
    .transform((v) => v.trim())
    .transform((v) => (v === '' ? null : v)),
  activo: z.boolean(),
});

/** Lo que el form maneja en estado local (todo string). */
export type ProfesorFormState = z.input<typeof profesorSchema>;
/** Lo que sale del schema validado (opcionales como string | null). */
export type ProfesorFormValues = z.output<typeof profesorSchema>;
