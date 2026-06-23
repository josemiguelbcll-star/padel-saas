import { z } from 'zod';
import { DURACIONES_TURNO_VALIDAS } from '../horarios/horariosSchema';

/**
 * Schema de una clase tal como la modela la migración 0005.
 *
 * profesor_id y cancha_id se validan como números positivos NOT NULL
 * (la DB exige ambos). El componente del form los gestiona como
 * `number | null` mientras el admin no haya elegido — pre-valida y
 * recién entonces invoca este schema.
 *
 * Notas:
 *   - nombre opcional con transform empty → null.
 *   - dias_semana NOT NULL en la DB; acá exigimos al menos 1 y a lo
 *     sumo 7 valores en [1..7], igual que el CHECK del backend.
 *   - hora_inicio restringida a HH:00 o HH:30 (espejo del CHECK
 *     clases_hora_alineada_30min). Aceptamos opcionalmente segundos
 *     en 00 para tolerar el formato 'HH:MM:00' de Postgres en edits.
 *   - duracion_min entre los 6 valores válidos (60, 90, 120, ...),
 *     reutilizamos la constante de horariosSchema.
 *   - precio: deprecated (0035, modelo B). El alquiler de cancha se
 *     resuelve via fn_resolver_tarifa_clase. La columna server-side
 *     tiene DEFAULT 0; el schema ya no la incluye.
 */
const HORA_ALINEADA_REGEX = /^\d{2}:(00|30)(:00)?$/;

export const claseSchema = z
  .object({
    profesor_id: z
      .number({ invalid_type_error: 'Elegí un profesor.' })
      .int()
      .positive('Elegí un profesor.'),
    cancha_id: z
      .number({ invalid_type_error: 'Elegí una cancha.' })
      .int()
      .positive('Elegí una cancha.'),
    nombre: z
      .string()
      .max(80, 'El nombre no puede tener más de 80 caracteres.')
      .transform((v) => v.trim())
      .transform((v) => (v === '' ? null : v)),
    dias_semana: z
      .array(z.number().int().min(1).max(7))
      .min(1, 'Seleccioná al menos un día.')
      .max(7, 'Demasiados días seleccionados.'),
    hora_inicio: z
      .string()
      .regex(HORA_ALINEADA_REGEX, 'La hora debe ser en punto o y media (ej. 10:00 o 10:30).'),
    duracion_min: z
      .number({ invalid_type_error: 'Elegí una duración válida.' })
      .refine(
        (n) => (DURACIONES_TURNO_VALIDAS as readonly number[]).includes(n),
        { message: 'La duración debe ser 60, 90, 120, 150, 180 o 240 minutos.' },
      ),
    activa: z.boolean(),
    es_recurrente: z.boolean().default(true),
    fecha_clase: z.string().nullable().optional(),
  })
  .refine(
    (data) => {
      if (data.es_recurrente === false) {
        return data.fecha_clase !== null && data.fecha_clase !== undefined && data.fecha_clase !== '';
      }
      return true;
    },
    {
      message: 'Completá la fecha para la clase única.',
      path: ['fecha_clase'],
    },
  );

export type ClaseFormValues = z.output<typeof claseSchema>;
