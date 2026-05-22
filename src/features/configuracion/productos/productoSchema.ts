import { z } from 'zod';
import type {
  CategoriaBuffet,
  CategoriaProducto,
  CategoriaShop,
  Linea,
} from '@/types/database';

/**
 * Categorías por línea (mismo split que el CHECK compuesto
 * `productos_categoria_segun_linea` de la migración 0024).
 *
 * Si más adelante las categorías se vuelven editables desde UI,
 * migramos a tabla `categorias_producto (linea, codigo)` con FK
 * compuesto. Hoy son enums fijos.
 */
export const CATEGORIAS_BUFFET = [
  'bebidas',
  'snacks',
  'comidas',
  'otros',
] as const satisfies readonly CategoriaBuffet[];

export const CATEGORIAS_SHOP = [
  'articulos_padel',
  'vestimenta',
  'palas',
  'accesorios',
] as const satisfies readonly CategoriaShop[];

export const LINEA_LABEL: Record<Linea, string> = {
  buffet: 'Buffet',
  shop: 'Shop',
};

export const CATEGORIA_LABEL: Record<CategoriaProducto, string> = {
  // Buffet
  bebidas: 'Bebidas',
  snacks: 'Snacks',
  comidas: 'Comidas',
  otros: 'Otros',
  // Shop
  articulos_padel: 'Pelotas / artículos',
  vestimenta: 'Vestimenta',
  palas: 'Palas',
  accesorios: 'Accesorios',
};

/**
 * Devuelve las categorías válidas para una línea dada. Lo usan el
 * form (para poblar el selector dependiente) y el catálogo (para
 * mostrar los pills secundarios).
 */
export function categoriasPermitidas(
  linea: Linea,
): readonly CategoriaProducto[] {
  return linea === 'buffet' ? CATEGORIAS_BUFFET : CATEGORIAS_SHOP;
}

/**
 * Type guard: ¿es categoria válida para la línea dada?
 */
export function esCategoriaValida(
  linea: Linea,
  categoria: string,
): categoria is CategoriaProducto {
  return (categoriasPermitidas(linea) as readonly string[]).includes(categoria);
}

/**
 * Categoría como enum de TODAS las posibles (union de buffet + shop).
 * El superRefine de abajo valida la coherencia con la línea elegida.
 */
const CATEGORIAS_TODAS = [
  ...CATEGORIAS_BUFFET,
  ...CATEGORIAS_SHOP,
] as const;

/**
 * Schema del producto.
 *
 * `linea` y `categoria` están relacionadas: la categoría debe pertenecer
 * al set de la línea. La validación es en dos niveles:
 *   1. `z.enum(CATEGORIAS_TODAS)`: la categoría tiene que ser una de
 *      las 8 posibles. Esto le da tipo `CategoriaProducto` al output.
 *   2. `superRefine`: además, debe pertenecer al set de la línea.
 *
 * `costo` es especial: NULLABLE en la DB y el form lo maneja como string
 * que puede estar vacío. Empty string → null (NO 0), preservando la
 * distinción "no cargado" vs "cuesta cero real" (ver migración 0010).
 */
export const productoSchema = z
  .object({
    nombre: z
      .string()
      .trim()
      .min(1, 'El nombre es obligatorio.')
      .max(120, 'El nombre no puede tener más de 120 caracteres.'),
    linea: z.enum(['buffet', 'shop'], {
      errorMap: () => ({ message: 'Elegí una línea válida.' }),
    }),
    categoria: z.enum(CATEGORIAS_TODAS, {
      errorMap: () => ({ message: 'Elegí una categoría válida.' }),
    }),
    precio: z.coerce
      .number({ invalid_type_error: 'Ingresá un precio válido.' })
      .min(0, 'El precio no puede ser negativo.'),
    costo: z.preprocess(
      (v) => {
        if (v === null || v === undefined) return null;
        if (typeof v === 'string') {
          const trimmed = v.trim();
          if (trimmed === '') return null;
          const n = Number(trimmed);
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
  })
  .superRefine((data, ctx) => {
    if (!esCategoriaValida(data.linea, data.categoria)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['categoria'],
        message: `La categoría "${data.categoria}" no es válida para línea ${LINEA_LABEL[data.linea]}.`,
      });
    }
  });

/** Estado local del form (numéricos como string del input). */
export interface ProductoFormState {
  nombre: string;
  linea: Linea;
  categoria: CategoriaProducto;
  precio: string;
  /** String del input. '' (vacío) = no cargado → se guarda como NULL. */
  costo: string;
  stock_minimo: string;
  activo: boolean;
}

/** Salida validada del schema, lista para mandar a la RPC/insert. */
export type ProductoFormValues = z.output<typeof productoSchema>;
