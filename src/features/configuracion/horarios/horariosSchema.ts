import { z } from 'zod';

/** Duraciones válidas de turno (espejo del CHECK de la migración 0003). */
export const DURACIONES_TURNO_VALIDAS = [60, 90, 120, 150, 180, 240] as const;
export type DuracionTurno = (typeof DURACIONES_TURNO_VALIDAS)[number];

/**
 * Schema de los horarios del club.
 *
 * Reglas (espejo de los CHECK constraints en `clubes`):
 *   - hora_apertura y hora_cierre pueden ser ambos null (club todavía
 *     no configuró), pero NO uno sí y el otro no.
 *   - Si ambos están seteados, hora_cierre debe ser estrictamente
 *     posterior a hora_apertura (comparación lexicográfica de strings
 *     'HH:MM' funciona porque están zero-padded).
 *   - duracion_turno_default tiene que ser uno del set permitido.
 */
export const horariosSchema = z
  .object({
    hora_apertura: z
      .string()
      .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Formato horario inválido (HH:MM).')
      .nullable(),
    hora_cierre: z
      .string()
      .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Formato horario inválido (HH:MM).')
      .nullable()
      .transform((val) => (val === '00:00' || val === '00:00:00' ? '24:00' : val)),
    duracion_turno_default: z
      .number({ invalid_type_error: 'Elegí una duración válida.' })
      .refine(
        (n) =>
          (DURACIONES_TURNO_VALIDAS as readonly number[]).includes(n),
        { message: 'La duración debe ser 60, 90, 120, 150, 180 o 240 minutos.' },
      ),
  })
  .refine(
    (data) => (data.hora_apertura === null) === (data.hora_cierre === null),
    {
      message: 'Completá las dos horas o dejá ambas vacías.',
      path: ['hora_apertura'],
    },
  )
  .refine(
    (data) => {
      if (data.hora_apertura === null || data.hora_cierre === null) return true;
      return data.hora_cierre > data.hora_apertura;
    },
    {
      message: 'El horario de cierre tiene que ser posterior al de apertura.',
      path: ['hora_cierre'],
    },
  );

export type HorariosFormValues = z.output<typeof horariosSchema>;
