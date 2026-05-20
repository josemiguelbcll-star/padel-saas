import { z } from 'zod';
import type { CategoriaProducto } from '@/types/database';

/**
 * Categorías permitidas (mismo enum que el CHECK en la migración 0009).
 * Si más adelante el club las quiere editables, migramos a tabla propia.
 */
export const CATEGORIAS_PRODUCTO = ['bebida', 'snack', 'otro'] as const;

export const CATEGORIA_LABEL: Record<CategoriaProducto, string> = {
  bebida: 'Bebida',
  snack: 'Snack',
  otro: 'Otro',
};

/**
 * Schema del producto. Los numéricos vienen como string del input y
 * coerceamos a number; el CHECK de la DB exige precio >= 0 y stock_minimo
 * entero >= 0.
 *
 * `costo` es especial: NULLABLE en la DB y el form lo maneja como string
 * que puede estar vacío. Empty string → null (NO 0), preservando la
 * distinción "no cargado" vs "cuesta cero real" (ver migración 0010).
 */
export const productoSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, 'El nombre es obligatorio.')
    .max(120, 'El nombre no puede tener más de 120 caracteres.'),
  categoria: z.enum(CATEGORIAS_PRODUCTO, {
    errorMap: () => ({ message: 'Elegí una categoría válida.' }),
  }),
  precio: z.coerce
    .number({ invalid_type_error: 'Ingresá un precio válido.' })
    .min(0, 'El precio no puede ser negativo.'),
  // Empty string en el input → null (no cargado). String numérico → number.
  // String no-numérico → falla con "Ingresá un costo válido.". No usamos
  // z.coerce.number() directo porque coerce("") = 0, lo que mentiría
  // diciendo "cuesta cero" cuando en realidad no se cargó.
  costo: z.preprocess(
    (v) => {
      if (v === null || v === undefined) return null;
      if (typeof v === 'string') {
        const trimmed = v.trim();
        if (trimmed === '') return null;
        const n = Number(trimmed);
        // Si no parsea, devolvemos el string raw para que z.number()
        // lo rechace con el mensaje de invalid_type_error.
        return Number.isNaN(n) ? trimmed : n;
      }
      return v;
    },
    z
      .number({ invalid_type_error: 'Ingresá un costo válido.' })
      .min(0, 'El costo no puede ser negativo.')
      .nullable(),
  ),
  stock_minimo: z.coerce
    .number({ invalid_type_error: 'Ingresá un stock mínimo válido.' })
    .int('El stock mínimo debe ser un número entero.')
    .min(0, 'El stock mínimo no puede ser negativo.'),
  activo: z.boolean(),
});

/** Estado local del form (numéricos como string del input). */
export interface ProductoFormState {
  nombre: string;
  categoria: CategoriaProducto;
  precio: string;
  /** String del input. '' (vacío) = no cargado → se guarda como NULL. */
  costo: string;
  stock_minimo: string;
  activo: boolean;
}

/** Salida validada del schema, lista para mandar a la RPC/insert. */
export type ProductoFormValues = z.output<typeof productoSchema>;
