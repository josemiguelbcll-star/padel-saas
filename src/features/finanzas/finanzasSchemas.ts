import { z } from 'zod';
import type { TipoUnidad } from '@/types/database';

/** Mismo enum que el CHECK de productos.linea/medio_pago en SQL. */
export const MEDIOS_PAGO = ['efectivo', 'transferencia', 'mp', 'tarjeta', 'otro'] as const;
export const MEDIO_PAGO_LABEL: Record<(typeof MEDIOS_PAGO)[number], string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  mp: 'Mercado Pago',
  tarjeta: 'Tarjeta',
  otro: 'Otro',
};

/** Mismo enum que productos_categoria_segun_linea check. */
export const TIPOS_UNIDAD: readonly TipoUnidad[] = [
  'canchas',
  'clases',
  'buffet',
  'shop',
  'auspicios',
  'membresias',
  'estructura',
  'otro',
];

export const TIPO_UNIDAD_LABEL: Record<TipoUnidad, string> = {
  canchas: 'Canchas',
  clases: 'Clases',
  buffet: 'Buffet',
  shop: 'Shop',
  auspicios: 'Auspicios',
  membresias: 'Membresías',
  estructura: 'Estructura',
  otro: 'Otro',
};

/** Para el listado: los 4 tipos con fuente automática (uno por club). */
export const TIPOS_AUTOMATICOS: readonly TipoUnidad[] = [
  'canchas',
  'clases',
  'buffet',
  'shop',
];

// ─── Schema: registrar gasto ─────────────────────────────────────────

export const registrarGastoSchema = z
  .object({
    categoria_id: z
      .number({ invalid_type_error: 'Elegí una categoría.' })
      .int()
      .positive('Elegí una categoría.'),
    monto: z
      .number({ invalid_type_error: 'Ingresá un monto válido.' })
      .positive('El monto debe ser mayor a 0.'),
    fecha_gasto: z
      .string()
      .min(1, 'La fecha del gasto es obligatoria.'),
    proveedor: z.string().trim().max(120, 'Máx. 120 caracteres.').optional(),
    observaciones: z.string().trim().max(2000, 'Máx. 2000 caracteres.').optional(),
    pagado: z.boolean(),
    medio_pago: z.enum(MEDIOS_PAGO).optional(),
    fecha_pago: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.pagado) {
      if (!data.medio_pago) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['medio_pago'],
          message: 'Elegí un medio de pago.',
        });
      }
      if (!data.fecha_pago) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['fecha_pago'],
          message: 'Elegí la fecha de pago.',
        });
      }
    }
  });

export type RegistrarGastoFormValues = z.infer<typeof registrarGastoSchema>;

// ─── Schema: registrar otro ingreso ──────────────────────────────────

export const registrarOtroIngresoSchema = z
  .object({
    unidad_id: z
      .number({ invalid_type_error: 'Elegí una unidad.' })
      .int()
      .positive('Elegí una unidad.'),
    concepto: z
      .string()
      .trim()
      .min(1, 'El concepto es obligatorio.')
      .max(200, 'Máx. 200 caracteres.'),
    monto: z
      .number({ invalid_type_error: 'Ingresá un monto válido.' })
      .positive('El monto debe ser mayor a 0.'),
    fecha: z.string().min(1, 'La fecha es obligatoria.'),
    observaciones: z.string().trim().max(2000, 'Máx. 2000 caracteres.').optional(),
    cobrado: z.boolean(),
    medio_pago: z.enum(MEDIOS_PAGO).optional(),
    fecha_cobro: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.cobrado) {
      if (!data.medio_pago) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['medio_pago'],
          message: 'Elegí un medio de pago.',
        });
      }
      if (!data.fecha_cobro) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['fecha_cobro'],
          message: 'Elegí la fecha de cobro.',
        });
      }
    }
  });

export type RegistrarOtroIngresoFormValues = z.infer<typeof registrarOtroIngresoSchema>;

// ─── Schema: unidad de negocio (ABM) ─────────────────────────────────

export const unidadSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, 'El nombre es obligatorio.')
    .max(80, 'Máx. 80 caracteres.'),
  tipo: z.enum(['canchas', 'clases', 'buffet', 'shop', 'auspicios', 'membresias', 'estructura', 'otro'], {
    errorMap: () => ({ message: 'Elegí un tipo válido.' }),
  }),
  activa: z.boolean(),
});

export type UnidadFormValues = z.infer<typeof unidadSchema>;

// ─── Schema: categoría de gasto (ABM) ────────────────────────────────

export const categoriaGastoSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, 'El nombre es obligatorio.')
    .max(80, 'Máx. 80 caracteres.'),
  unidad_id: z
    .number({ invalid_type_error: 'Elegí una unidad.' })
    .int()
    .positive('Elegí una unidad.'),
  activa: z.boolean(),
});

export type CategoriaGastoFormValues = z.infer<typeof categoriaGastoSchema>;
