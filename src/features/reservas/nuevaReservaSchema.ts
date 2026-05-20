import { z } from 'zod';

/** Estados con los que puede arrancar una reserva nueva. */
export const ESTADOS_INICIALES = ['pendiente', 'senada', 'pagada'] as const;
export type EstadoInicial = (typeof ESTADOS_INICIALES)[number];

export const MEDIOS_PAGO = [
  'efectivo',
  'transferencia',
  'mp',
  'tarjeta',
  'otro',
] as const;
export type MedioPagoForm = (typeof MEDIOS_PAGO)[number];

/**
 * Duración fija de los partidos en el modelo actual del Sprint 3a (post
 * cambio de modelo): todos los turnos reservables son de 90 min. Las
 * clases tienen su propia duración y no pasan por este modal.
 */
export const DURACION_PARTIDO_MIN = 90;

/**
 * Schema de los campos "no-jugador" del modal de nueva reserva.
 *
 * La validación de titular + acompañantes (estructura compleja con
 * unión discriminada jugador/libre) se hace en el componente. Acá
 * cubrimos los CHECK constraints que la migración 0004 impone y los
 * estados consistentes del pago.
 *
 * `duracion_min` NO está en el schema: el modal no la pide. El componente
 * envía DURACION_PARTIDO_MIN (90) a la RPC.
 */
export const nuevaReservaCamposSchema = z
  .object({
    monto_total: z.coerce
      .number({ invalid_type_error: 'Ingresá un monto válido.' })
      .min(0, 'El monto debe ser mayor o igual a 0.'),
    estado: z.enum(ESTADOS_INICIALES, {
      errorMap: () => ({ message: 'Estado inválido.' }),
    }),
    monto_pagado: z.coerce
      .number({ invalid_type_error: 'Ingresá un monto válido.' })
      .min(0, 'El monto pagado debe ser mayor o igual a 0.'),
    medio_pago: z.enum(MEDIOS_PAGO).nullable(),
    observaciones: z.string().trim().nullable(),
  })
  .refine((d) => d.monto_pagado <= d.monto_total, {
    message: 'El monto pagado no puede ser mayor al total.',
    path: ['monto_pagado'],
  })
  .refine((d) => d.estado !== 'pendiente' || d.monto_pagado === 0, {
    message: 'Una reserva pendiente no tiene monto pagado.',
    path: ['monto_pagado'],
  })
  .refine(
    (d) => {
      if (d.estado === 'senada' || d.estado === 'pagada') {
        return d.monto_pagado > 0;
      }
      return true;
    },
    {
      message: 'Ingresá el monto cobrado.',
      path: ['monto_pagado'],
    },
  )
  .refine((d) => d.monto_pagado === 0 || d.medio_pago !== null, {
    message: 'Elegí un medio de pago.',
    path: ['medio_pago'],
  });

export type NuevaReservaCampos = z.output<typeof nuevaReservaCamposSchema>;
