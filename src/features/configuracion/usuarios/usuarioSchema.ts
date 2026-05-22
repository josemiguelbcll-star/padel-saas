import { z } from 'zod';

/**
 * Schemas zod del módulo de usuarios. Validan en el frontend antes
 * del round-trip a la Edge Function / a Postgres. Los mismos límites
 * los aplica la Edge Function `crear-vendedor` server-side (defense
 * in depth).
 */

export const nuevoUsuarioSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, 'El nombre es obligatorio.')
    .max(120, 'El nombre puede tener hasta 120 caracteres.'),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(5, 'Email demasiado corto.')
    .max(120, 'Email demasiado largo.')
    .email('Email inválido.'),
  password: z
    .string()
    .min(8, 'La contraseña debe tener al menos 8 caracteres.')
    .max(72, 'La contraseña puede tener hasta 72 caracteres.'),
  rol: z.enum(['admin', 'vendedor'], {
    errorMap: () => ({ message: 'Rol inválido.' }),
  }),
});

export type NuevoUsuarioInput = z.infer<typeof nuevoUsuarioSchema>;

export const editarUsuarioSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, 'El nombre es obligatorio.')
    .max(120, 'El nombre puede tener hasta 120 caracteres.'),
  rol: z.enum(['admin', 'vendedor'], {
    errorMap: () => ({ message: 'Rol inválido.' }),
  }),
});

export type EditarUsuarioInput = z.infer<typeof editarUsuarioSchema>;
