import { z } from 'zod';
import type {
  CategoriaJugador,
  GeneroJugador,
  PosicionJugador,
} from '@/types/database';

// Listas y labels visibles. Las usamos tanto en el form (pills/select)
// como en la tabla (mapeo enum → texto display).
export const GENEROS = ['masculino', 'femenino', 'otro'] as const satisfies
  readonly GeneroJugador[];

export const CATEGORIAS = [
  'octava',
  'septima',
  'sexta',
  'quinta',
  'cuarta',
  'tercera',
  'segunda',
  'primera',
] as const satisfies readonly CategoriaJugador[];

export const POSICIONES = ['drive', 'reves', 'ambos'] as const satisfies
  readonly PosicionJugador[];

export const GENERO_LABEL: Record<GeneroJugador, string> = {
  masculino: 'Masculino',
  femenino: 'Femenino',
  otro: 'Otro',
};

/**
 * Categorías abreviadas (1ra a 8va) — formato estándar del pádel
 * argentino. Más compacto que "Primera/Segunda/..." en tablas.
 */
export const CATEGORIA_LABEL: Record<CategoriaJugador, string> = {
  primera: '1ra',
  segunda: '2da',
  tercera: '3ra',
  cuarta: '4ta',
  quinta: '5ta',
  sexta: '6ta',
  septima: '7ma',
  octava: '8va',
};

export const POSICION_LABEL: Record<PosicionJugador, string> = {
  drive: 'Drive',
  reves: 'Revés',
  ambos: 'Ambos',
};

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Schema de la ficha de jugador. Sólo `nombre` es obligatorio; el resto
 * opcional (texto libre → null si vacío, enums → null si "Sin
 * especificar"). Mismo patrón "string vacío → null" que ya usamos en
 * profesores y productos (sinceridad: no guardamos un valor inventado
 * si el usuario no lo cargó).
 */
export const jugadorSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, 'El nombre es obligatorio.')
    .max(120, 'El nombre no puede tener más de 120 caracteres.'),
  telefono: z
    .string()
    .max(40, 'El teléfono no puede tener más de 40 caracteres.')
    .transform((v) => v.trim())
    .transform((v) => (v === '' ? null : v)),
  email: z
    .string()
    .max(120, 'El email no puede tener más de 120 caracteres.')
    .transform((v) => v.trim())
    .transform((v) => (v === '' ? null : v))
    .refine((v) => v === null || emailRegex.test(v), {
      message: 'Ingresá un email válido.',
    }),
  notas: z
    .string()
    .transform((v) => v.trim())
    .transform((v) => (v === '' ? null : v)),
  // Enums opcionales: el form los maneja como `enum | ''`. El '' (pill
  // "Sin especificar") se transforma a null para que la DB lo guarde
  // explícitamente como NULL — NO como string vacío ni como un valor
  // inventado. Coherente con la decisión arquitectónica de la 0011.
  genero: z
    .union([z.enum(GENEROS), z.literal('')])
    .transform((v): GeneroJugador | null => (v === '' ? null : v)),
  categoria: z
    .union([z.enum(CATEGORIAS), z.literal('')])
    .transform((v): CategoriaJugador | null => (v === '' ? null : v)),
  posicion: z
    .union([z.enum(POSICIONES), z.literal('')])
    .transform((v): PosicionJugador | null => (v === '' ? null : v)),
  activo: z.boolean(),
  limite_credito: z.coerce
    .number()
    .min(0, 'El límite de crédito debe ser mayor o igual a 0.')
    .default(0),
});

/** Estado local del form. Los enums usan `''` para representar "Sin especificar". */
export interface JugadorFormState {
  nombre: string;
  telefono: string;
  email: string;
  notas: string;
  genero: GeneroJugador | '';
  categoria: CategoriaJugador | '';
  posicion: PosicionJugador | '';
  activo: boolean;
  limite_credito: number;
}

/** Salida validada del schema, lista para mandar a useCreateJugador / useUpdateJugador. */
export type JugadorFormValues = z.output<typeof jugadorSchema>;

