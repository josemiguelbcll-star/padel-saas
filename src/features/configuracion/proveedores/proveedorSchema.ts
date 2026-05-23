import { z } from 'zod';

/**
 * Validación del form de proveedor. Coincide con la tabla `proveedores`
 * de la migración 0038:
 *
 *   - `nombre` 1-120 chars, obligatorio. El server tiene UNIQUE
 *     funcional sobre (club_id, lower(nombre)) que el frontend no
 *     replica — si choca, llega el SQLSTATE 23505 mapeado a "Ya existe
 *     un registro con esos datos."
 *   - El resto son opcionales con límites generosos. Sin CHECK de
 *     formato (CUIT/email/teléfono): coherente con el server.
 *
 * La normalización "" → null vive en `useProveedores.sanitizeInput`
 * (justo antes del insert/update), NO en el schema, porque depende del
 * shape de la DB y no de la validación lógica.
 */
export const proveedorSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, 'El nombre es obligatorio.')
    .max(120, 'El nombre no puede tener más de 120 caracteres.'),
  cuit: z
    .string()
    .trim()
    .max(20, 'El CUIT no puede tener más de 20 caracteres.')
    .optional()
    .default(''),
  contacto_persona: z
    .string()
    .trim()
    .max(120, 'El nombre de contacto no puede tener más de 120 caracteres.')
    .optional()
    .default(''),
  contacto_telefono: z
    .string()
    .trim()
    .max(40, 'El teléfono no puede tener más de 40 caracteres.')
    .optional()
    .default(''),
  contacto_email: z
    .string()
    .trim()
    .max(120, 'El email no puede tener más de 120 caracteres.')
    .optional()
    .default(''),
  // Textos largos: límite generoso (~ 1k) para evitar pegadas accidentales
  // de documentos enteros. NO restringimos formato.
  condiciones_pago: z
    .string()
    .trim()
    .max(1000, 'Las condiciones de pago no pueden tener más de 1000 caracteres.')
    .optional()
    .default(''),
  que_provee: z
    .string()
    .trim()
    .max(1000, 'La descripción no puede tener más de 1000 caracteres.')
    .optional()
    .default(''),
  notas: z
    .string()
    .trim()
    .max(2000, 'Las notas no pueden tener más de 2000 caracteres.')
    .optional()
    .default(''),
  activo: z.boolean(),
});

/** Estado local del form (todos los strings convivien con string vacío). */
export interface ProveedorFormState {
  nombre: string;
  cuit: string;
  contacto_persona: string;
  contacto_telefono: string;
  contacto_email: string;
  condiciones_pago: string;
  que_provee: string;
  notas: string;
  activo: boolean;
}

/** Salida validada del schema. Los opcionales pueden ser ''; el hook los pasa a null. */
export type ProveedorFormValues = z.output<typeof proveedorSchema>;
