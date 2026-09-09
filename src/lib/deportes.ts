export type DeporteId =
  | 'padel'
  | 'tenis'
  | 'pickleball'
  | 'futbol'
  | 'futbol_5'
  | 'squash'
  | 'basquet'
  | 'otro';

export interface DeporteInfo {
  id: DeporteId;
  label: string;
  icono: string;
  duracionesSugeridas: number[];
}

export const DEPORTES_CATALOGO: readonly DeporteInfo[] = [
  {
    id: 'padel',
    label: 'Pádel',
    icono: '🔲',
    duracionesSugeridas: [60, 90, 120],
  },
  {
    id: 'tenis',
    label: 'Tenis',
    icono: '🎾',
    duracionesSugeridas: [60, 90, 120],
  },
  {
    id: 'pickleball',
    label: 'Pickleball',
    icono: '🏓',
    duracionesSugeridas: [60, 90, 120],
  },
  {
    id: 'futbol',
    label: 'Fútbol',
    icono: '⚽',
    duracionesSugeridas: [60, 90, 120],
  },
  {
    id: 'futbol_5',
    label: 'Fútbol 5',
    icono: '🥅',
    duracionesSugeridas: [60, 90],
  },
  {
    id: 'squash',
    label: 'Squash',
    icono: '🏸',
    duracionesSugeridas: [45, 60],
  },
  {
    id: 'basquet',
    label: 'Básquet',
    icono: '🏀',
    duracionesSugeridas: [60, 90],
  },
  {
    id: 'otro',
    label: 'Otro',
    icono: '🏆',
    duracionesSugeridas: [60, 90, 120],
  },
] as const;

export function obtenerInfoDeporte(id: string | null | undefined): DeporteInfo {
  if (!id) return DEPORTES_CATALOGO[0]!;
  const found = DEPORTES_CATALOGO.find((d) => d.id === id);
  if (found) return found;
  return {
    id: 'otro',
    label: id.charAt(0).toUpperCase() + id.slice(1),
    icono: '🏆',
    duracionesSugeridas: [60, 90, 120],
  };
}

/**
 * Detecta inteligentemente el deporte de una cancha a partir de su campo
 * explícito `deporte` o analizando su `nombre` y `tipo`.
 * Garantiza retrocompatibilidad total con canchas existentes.
 */
export function detectarDeporte(cancha: {
  nombre?: string;
  tipo?: string | null;
  deporte?: string | null;
}): DeporteId {
  if (cancha.deporte) {
    const dLower = cancha.deporte.toLowerCase().trim();
    if (dLower === 'padel' || dLower === 'pádel') return 'padel';
    if (dLower === 'tenis' || dLower === 'tennis') return 'tenis';
    if (dLower === 'pickleball' || dLower === 'piketbol') return 'pickleball';
    if (dLower === 'futbol' || dLower === 'fútbol') return 'futbol';
    if (dLower === 'futbol_5' || dLower === 'futbol 5' || dLower === 'fútbol 5') return 'futbol_5';
    if (dLower === 'squash') return 'squash';
    if (dLower === 'basquet' || dLower === 'básquet' || dLower === 'basketball') return 'basquet';
    return 'otro';
  }

  const texto = `${cancha.nombre ?? ''} ${cancha.tipo ?? ''}`.toLowerCase();

  if (texto.includes('pickleball') || texto.includes('piketbol')) return 'pickleball';
  if (texto.includes('tenis') || texto.includes('tennis')) return 'tenis';
  if (texto.includes('futbol 5') || texto.includes('fútbol 5') || texto.includes('f5')) return 'futbol_5';
  if (texto.includes('futbol') || texto.includes('fútbol') || texto.includes('soccer')) return 'futbol';
  if (texto.includes('squash')) return 'squash';
  if (texto.includes('basquet') || texto.includes('básquet') || texto.includes('basket')) return 'basquet';
  if (texto.includes('padel') || texto.includes('pádel')) return 'padel';

  // Default a pádel si no hay indicios
  return 'padel';
}
