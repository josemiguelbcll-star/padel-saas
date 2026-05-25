import { z } from 'zod';
import { DURACIONES_TURNO_VALIDAS } from './horariosSchema';

/** Días de la semana en convención SaaS (1=lun..7=dom) + labels. */
export const DIAS_SEMANA: ReadonlyArray<{ n: number; label: string; full: string }> = [
  { n: 1, label: 'Lun', full: 'Lunes' },
  { n: 2, label: 'Mar', full: 'Martes' },
  { n: 3, label: 'Mié', full: 'Miércoles' },
  { n: 4, label: 'Jue', full: 'Jueves' },
  { n: 5, label: 'Vie', full: 'Viernes' },
  { n: 6, label: 'Sáb', full: 'Sábado' },
  { n: 7, label: 'Dom', full: 'Domingo' },
];

const horaRegex = /^\d{2}:\d{2}(:\d{2})?$/;

/**
 * Schema del form de una franja de turno (espejo de los CHECK de la
 * tabla franjas_turno, 0050). `dias_semana` y `duraciones_min` se editan
 * como arrays; la conversión "todos los días → NULL" se hace al guardar.
 */
export const franjaTurnoSchema = z
  .object({
    nombre: z
      .string()
      .trim()
      .min(1, 'El nombre es obligatorio.')
      .max(80, 'Máx. 80 caracteres.'),
    desde_hora: z
      .string()
      .regex(horaRegex, 'Formato horario inválido (HH:MM).')
      .nullable(),
    hasta_hora: z
      .string()
      .regex(horaRegex, 'Formato horario inválido (HH:MM).')
      .nullable(),
    dias_semana: z
      .array(z.number().int().min(1).max(7))
      .min(1, 'Elegí al menos un día.'),
    duraciones_min: z
      .array(z.number().int())
      .min(1, 'Elegí al menos una duración.')
      .refine(
        (arr) =>
          arr.every((d) =>
            (DURACIONES_TURNO_VALIDAS as readonly number[]).includes(d),
          ),
        { message: 'Duración inválida.' },
      ),
    prioridad: z.number().int(),
    cancha_id: z.number().int().positive().nullable(),
  })
  .refine((d) => (d.desde_hora === null) === (d.hasta_hora === null), {
    message: 'Completá las dos horas, o dejá ambas vacías (aplica a toda hora).',
    path: ['desde_hora'],
  })
  .refine(
    (d) =>
      d.desde_hora === null ||
      d.hasta_hora === null ||
      d.hasta_hora > d.desde_hora,
    {
      message: 'El "hasta" tiene que ser posterior al "desde".',
      path: ['hasta_hora'],
    },
  );

export type FranjaTurnoFormValues = z.output<typeof franjaTurnoSchema>;
