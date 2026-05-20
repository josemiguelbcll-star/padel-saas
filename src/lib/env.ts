import { z } from 'zod';

/**
 * Validación de variables de entorno expuestas al frontend (prefijo VITE_).
 *
 * - Si falta una variable requerida o tiene formato inválido, este módulo
 *   lanza un Error en castellano al momento de importarse (en main.tsx).
 *   Eso garantiza que la app no arranque silenciosamente sin Supabase.
 *
 * - El DSN de Sentry es opcional: si está vacío, Sentry no se inicializa
 *   (ver src/lib/sentry.ts).
 *
 * - IMPORTANTE: acá NUNCA debe figurar SUPABASE_SERVICE_ROLE_KEY ni
 *   ninguna otra credencial privilegiada. El frontend usa exclusivamente
 *   la anon key, protegida por RLS.
 */
const envSchema = z.object({
  VITE_SUPABASE_URL: z
    .string({
      required_error:
        'VITE_SUPABASE_URL es obligatoria. Definila en .env.local con la URL del proyecto Supabase.',
    })
    .min(
      1,
      'VITE_SUPABASE_URL no puede estar vacía. Pegá la URL del proyecto Supabase en .env.local.',
    )
    .url(
      'VITE_SUPABASE_URL debe ser una URL válida (por ejemplo https://xxxxx.supabase.co).',
    ),
  VITE_SUPABASE_ANON_KEY: z
    .string({
      required_error:
        'VITE_SUPABASE_ANON_KEY es obligatoria. Definila en .env.local con la anon/publishable key del proyecto. NUNCA pongas la service_role_key acá.',
    })
    .min(
      1,
      'VITE_SUPABASE_ANON_KEY no puede estar vacía. Copiá la anon key (NO la service_role_key) desde Supabase → Project Settings → API.',
    ),
  VITE_SENTRY_DSN: z.string().optional().default(''),
});

const parsed = envSchema.safeParse(import.meta.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(
    `[padel-saas] Variables de entorno inválidas o ausentes. Revisá tu archivo .env.local en la raíz del proyecto:\n${issues}`,
  );
}

export const env = parsed.data;
