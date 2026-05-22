import { supabase } from '@/lib/supabase';

/**
 * Marca del club — Nivel 2 (color + logo).
 *
 * Cada club elige su color de marca desde una paleta CURADA (no picker
 * libre — evita elecciones ilegibles tipo neón sobre blanco). El color
 * se inyecta en el token CSS `--primary` del :root al cargar la
 * sesión; el `--ring` se propaga gratis porque está linkeado como
 * `--ring: var(--primary)` en globals.css.
 *
 * Formato: HSL triple SIN wrap `hsl()`, convención shadcn. Cada opción
 * está ajustada para mantener contraste WCAG AA con texto blanco
 * encima (el `--primary-foreground` queda fijo en `0 0% 100%` y no se
 * toca).
 *
 * La paleta vive en código (no en DB) porque puede cambiar entre
 * deploys. El club guarda el HSL elegido — si en el futuro la paleta
 * cambia, las elecciones viejas siguen siendo HSL válidos (el HSL no
 * depende del catálogo). Si quitamos una opción del catálogo, los
 * clubes que la tenían siguen viéndola — solo no aparece al elegir
 * uno nuevo.
 */

/** Clave de localStorage para el preload anti-flash (ver index.html). */
export const LOCALSTORAGE_KEY_COLOR_MARCA = 'club_color_primario';

export interface OpcionColorMarca {
  /** ID estable (no se usa en DB; solo para listas de React). */
  id: string;
  /** Nombre visible en la UI. */
  nombre: string;
  /** Valor HSL triple sin wrap (lo que se guarda en clubes.color_primario_hsl). */
  hsl: string;
}

/**
 * Paleta curada — 8 opciones pensadas para legibilidad y variedad.
 *
 * El "Verde esmeralda" usa H=158 (verde-teal) en vez del H=142 del
 * token `--estado-pagada` (verde más amarillento) para que un club
 * verde no confunda visualmente los botones primarios con el estado
 * 'pagada' de la grilla de reservas.
 *
 * Si en el futuro queremos sumar opciones, agregar acá basta. Si
 * queremos un free-picker para usuarios pro, sería otra UI; la DB
 * soporta cualquier HSL válido sin migración.
 */
export const PALETA_COLORES_MARCA: readonly OpcionColorMarca[] = [
  { id: 'azul-corporativo', nombre: 'Azul corporativo', hsl: '221 83% 53%' },
  { id: 'verde-esmeralda', nombre: 'Verde esmeralda', hsl: '158 64% 40%' },
  { id: 'naranja-energia', nombre: 'Naranja energía', hsl: '25 95% 50%' },
  { id: 'rojo-pasion', nombre: 'Rojo pasión', hsl: '0 84% 55%' },
  { id: 'purpura', nombre: 'Púrpura', hsl: '271 70% 55%' },
  { id: 'cyan-oceano', nombre: 'Cyan océano', hsl: '190 90% 45%' },
  { id: 'rosa', nombre: 'Rosa', hsl: '336 80% 55%' },
  { id: 'gris-pizarra', nombre: 'Gris pizarra', hsl: '215 25% 30%' },
] as const;

/**
 * Aplica un color al token CSS `--primary` del :root. El cambio es
 * inmediato — las CSS variables son live, todo el tema repinta.
 *
 * Idempotente: setear el mismo valor dos veces no hace nada.
 * Defensivo contra ambientes sin `document` (SSR, tests sin jsdom).
 */
export function aplicarColorMarca(hsl: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--primary', hsl);
}

/**
 * Guarda el color elegido en `localStorage` para que el bootstrap del
 * próximo reload lo aplique ANTES de que React monte (anti-flash —
 * ver script inline en `index.html`). Defensivo: si `localStorage`
 * no está disponible (modo privado, quota), falla silenciosa.
 */
export function guardarColorMarcaEnCache(hsl: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCALSTORAGE_KEY_COLOR_MARCA, hsl);
  } catch {
    // Modo privado, quota llena, etc. — sin cache para esta sesión.
  }
}

// ─────────────────────────────────────────────────────────────────────
// Logo del club — Nivel 2, Etapa 2 (Storage)
// ─────────────────────────────────────────────────────────────────────

/** Bucket público de logos (migración 0017). */
export const LOGOS_BUCKET = 'logos-clubes';

/** Límite de tamaño server-side (storage.buckets.file_size_limit). */
export const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * MIME types permitidos. Coincide con `storage.buckets.allowed_mime_types`
 * de la 0017 (defense in depth — el frontend valida primero, Storage
 * rechaza si bypassan). SVG queda fuera por riesgo XSS sin validación
 * server-side de contenido.
 */
export const ALLOWED_LOGO_MIMES = ['image/png', 'image/jpeg'] as const;
export type AllowedLogoMime = (typeof ALLOWED_LOGO_MIMES)[number];

/**
 * Construye la URL pública del logo del club. El bucket es público
 * (0017), así que la URL se sirve directo sin firmar.
 *
 * Si `path` es null/vacío, retorna null (UI muestra solo nombre).
 *
 * El cache-busting es natural: cada upload genera un UUID nuevo → el
 * path cambia → la URL cambia → el browser no sirve un PNG viejo
 * cuando el club sube uno nuevo.
 */
export function getLogoClubUrl(path: string | null): string | null {
  if (!path) return null;
  return supabase.storage.from(LOGOS_BUCKET).getPublicUrl(path).data
    .publicUrl;
}
