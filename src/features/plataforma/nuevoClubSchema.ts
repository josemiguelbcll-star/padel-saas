import { z } from 'zod';

/**
 * Schemas zod del onboarding de clubes (Edge Function `crear-club`).
 * Validan en el frontend antes del round-trip a la función. Los mismos
 * límites los aplica `crear-club` server-side (defense in depth).
 */

export const nuevoClubSchema = z.object({
  club: z.object({
    nombre: z
      .string()
      .trim()
      .min(1, 'El nombre del club es obligatorio.')
      .max(120, 'El nombre puede tener hasta 120 caracteres.'),
    plan_id: z
      .number({ invalid_type_error: 'Seleccioná un plan.' })
      .int()
      .positive('Seleccioná un plan.'),
  }),
  admin: z.object({
    nombre: z
      .string()
      .trim()
      .min(1, 'El nombre del administrador es obligatorio.')
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
  }),
});

export type NuevoClubInput = z.infer<typeof nuevoClubSchema>;
