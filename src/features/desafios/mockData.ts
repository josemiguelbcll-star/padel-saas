// ────────────────────────────────────────────────────────────────────────────
// PROTOTIPO VISUAL — "Desafíos de parejas" dentro de MatchGo.
// Datos MOCK, sin backend.
// ────────────────────────────────────────────────────────────────────────────

export interface Jugador {
  id: number;
  nombre: string;    // "Diego R." — nombre corto como en un club real
  nombreCompleto: string; // "Diego Ramos"
  avatar: string;    // iniciales para el avatar
  categoria: number;
  zona: string;
}

export interface Pareja {
  id: number;
  apodo?: string;    // OPCIONAL — la pareja puede no tener apodo
  jugadores: [Jugador, Jugador];
  categoria: number; // categoría de la dupla (promedio / la más alta)
  rating: number;
  posicion: number;
  racha: number;
  pj: number;
  pg: number;
  esMia?: boolean;
}

export interface Circulo {
  id: number;
  nombre: string;
  zona: string;
  miembros: number;
  desafiosActivos: number;
}

export type EstadoDesafio =
  | 'recibido'
  | 'enviado'
  | 'agendado'
  | 'a_confirmar'
  | 'jugado';

export interface Desafio {
  id: number;
  estado: EstadoDesafio;
  rival: Pareja;
  club?: string;
  fecha?: string;
  hora?: string;
  cancha?: string;
  precio?: number;
  resultado?: { miosSets: number; rivalSets: number; gane: boolean };
  subeA?: number;
}

export interface SlotMock {
  hora: string;
  club: string;
  cancha: string;
  precio: number;
  valle?: boolean;
}

// ── Jugadores buscables (para el flujo "Invitar compañero") ───────────────────
export const jugadoresBuscables: Jugador[] = [
  { id: 30, nombre: 'Ramiro C.', nombreCompleto: 'Ramiro Castro', avatar: 'RC', categoria: 6, zona: 'Salta Centro' },
  { id: 31, nombre: 'Matías D.', nombreCompleto: 'Matías Díaz', avatar: 'MD', categoria: 6, zona: 'Salta Norte' },
  { id: 32, nombre: 'Valentín P.', nombreCompleto: 'Valentín Ponce', avatar: 'VP', categoria: 7, zona: 'Salta Centro' },
  { id: 33, nombre: 'Facundo L.', nombreCompleto: 'Facundo López', avatar: 'FL', categoria: 6, zona: 'Bº Limache' },
  { id: 34, nombre: 'Gabi M.', nombreCompleto: 'Gabriela Morales', avatar: 'GM', categoria: 6, zona: 'Salta Centro' },
];

// ── Mi jugador (yo) ───────────────────────────────────────────────────────────
export const miJugador: Jugador = {
  id: 1, nombre: 'José Miguel', nombreCompleto: 'José Miguel B.',
  avatar: 'JM', categoria: 6, zona: 'Salta Centro',
};

// ── La pareja del usuario ─────────────────────────────────────────────────────
export const miPareja: Pareja = {
  id: 7,
  jugadores: [
    miJugador,
    { id: 2, nombre: 'Pedro A.', nombreCompleto: 'Pedro Alderete', avatar: 'PA', categoria: 6, zona: 'Salta Centro' },
  ],
  categoria: 6,
  rating: 1482,
  posicion: 7,
  racha: 2,
  pj: 22,
  pg: 13,
  esMia: true,
};

// ── El círculo activo ─────────────────────────────────────────────────────────
export const circulo: Circulo = {
  nombre: 'Pádel Salta Centro',
  id: 1,
  zona: 'Salta Capital',
  miembros: 12,
  desafiosActivos: 6,
};

// ── La escalera (ladder) 12 parejas — SIN apodos obligatorios ────────────────
export const escalera: Pareja[] = [
  {
    id: 1, categoria: 5, rating: 1720, posicion: 1, racha: 5, pj: 24, pg: 20,
    jugadores: [
      { id: 10, nombre: 'Diego R.', nombreCompleto: 'Diego Romero', avatar: 'DR', categoria: 5, zona: 'Salta Norte' },
      { id: 11, nombre: 'Nico F.', nombreCompleto: 'Nicolás Flores', avatar: 'NF', categoria: 5, zona: 'Salta Norte' },
    ],
  },
  {
    id: 2, categoria: 5, rating: 1685, posicion: 2, racha: 1, pj: 22, pg: 16,
    jugadores: [
      { id: 12, nombre: 'Caro V.', nombreCompleto: 'Carolina Vega', avatar: 'CV', categoria: 5, zona: 'Salta Centro' },
      { id: 13, nombre: 'Sofi L.', nombreCompleto: 'Sofía Luján', avatar: 'SL', categoria: 5, zona: 'Salta Centro' },
    ],
  },
  {
    id: 3, categoria: 6, rating: 1610, posicion: 3, racha: -1, pj: 26, pg: 17,
    jugadores: [
      { id: 14, nombre: 'Marcos T.', nombreCompleto: 'Marcos Torres', avatar: 'MT', categoria: 6, zona: 'Bº Limache' },
      { id: 15, nombre: 'Juli P.', nombreCompleto: 'Juliana Paz', avatar: 'JP', categoria: 6, zona: 'Bº Limache' },
    ],
  },
  {
    id: 4, categoria: 6, rating: 1560, posicion: 4, racha: 3, pj: 18, pg: 12,
    jugadores: [
      { id: 16, nombre: 'Lucas B.', nombreCompleto: 'Lucas Bustos', avatar: 'LB', categoria: 6, zona: 'Salta Sur' },
      { id: 17, nombre: 'Fede M.', nombreCompleto: 'Federico Medina', avatar: 'FM', categoria: 6, zona: 'Salta Sur' },
    ],
  },
  {
    id: 5, categoria: 6, rating: 1538, posicion: 5, racha: -2, pj: 19, pg: 10,
    jugadores: [
      { id: 18, nombre: 'Ani C.', nombreCompleto: 'Aníbal Cortez', avatar: 'AC', categoria: 6, zona: 'Salta Norte' },
      { id: 19, nombre: 'Vale D.', nombreCompleto: 'Valentina Díaz', avatar: 'VD', categoria: 6, zona: 'Salta Norte' },
    ],
  },
  {
    id: 6, categoria: 6, rating: 1510, posicion: 6, racha: 1, pj: 15, pg: 8,
    jugadores: [
      { id: 20, nombre: 'Tomi G.', nombreCompleto: 'Tomás García', avatar: 'TG', categoria: 6, zona: 'Salta Centro' },
      { id: 21, nombre: 'Santi R.', nombreCompleto: 'Santiago Ríos', avatar: 'SR', categoria: 6, zona: 'Salta Centro' },
    ],
  },
  miPareja, // posición 7
  {
    id: 8, categoria: 7, rating: 1455, posicion: 8, racha: -1, pj: 17, pg: 7,
    jugadores: [
      { id: 22, nombre: 'Eze P.', nombreCompleto: 'Ezequiel Pérez', avatar: 'EP', categoria: 7, zona: 'Salta Sur' },
      { id: 23, nombre: 'Maxi S.', nombreCompleto: 'Maximiliano Sosa', avatar: 'MS', categoria: 7, zona: 'Salta Sur' },
    ],
  },
  {
    id: 9, categoria: 7, rating: 1420, posicion: 9, racha: 2, pj: 14, pg: 7,
    jugadores: [
      { id: 24, nombre: 'Ramiro A.', nombreCompleto: 'Ramiro Altamirano', avatar: 'RA', categoria: 7, zona: 'Bº Limache' },
      { id: 25, nombre: 'Bruno V.', nombreCompleto: 'Bruno Villalba', avatar: 'BV', categoria: 7, zona: 'Bº Limache' },
    ],
  },
  {
    id: 10, categoria: 7, rating: 1388, posicion: 10, racha: -3, pj: 18, pg: 5,
    jugadores: [
      { id: 26, nombre: 'Lauti M.', nombreCompleto: 'Lautaro Molina', avatar: 'LM', categoria: 7, zona: 'Salta Norte' },
      { id: 27, nombre: 'Joaco T.', nombreCompleto: 'Joaquín Toledo', avatar: 'JT', categoria: 7, zona: 'Salta Norte' },
    ],
  },
  {
    id: 11, categoria: 7, rating: 1352, posicion: 11, racha: 1, pj: 10, pg: 4,
    jugadores: [
      { id: 28, nombre: 'Seba H.', nombreCompleto: 'Sebastián Herrera', avatar: 'SH', categoria: 7, zona: 'Salta Centro' },
      { id: 29, nombre: 'Pipe G.', nombreCompleto: 'Felipe Gutiérrez', avatar: 'PG', categoria: 7, zona: 'Salta Centro' },
    ],
  },
  {
    id: 12, categoria: 8, rating: 1310, posicion: 12, racha: -2, pj: 8, pg: 2,
    jugadores: [
      { id: 35, nombre: 'Nacho V.', nombreCompleto: 'Ignacio Vargas', avatar: 'NV', categoria: 8, zona: 'Salta Sur' },
      { id: 36, nombre: 'Darío F.', nombreCompleto: 'Darío Fuentes', avatar: 'DF', categoria: 8, zona: 'Salta Sur' },
    ],
  },
];

// ── Desafíos del usuario — lista realista con historial ───────────────────────
export const desafios: Desafio[] = [
  // ── ACTIVOS ──────────────────────────────────────────────────────────────────

  // Te desafiaron
  {
    id: 101, estado: 'recibido',
    rival: escalera[5]!, subeA: 6,
  },
  {
    id: 102, estado: 'recibido',
    rival: escalera[7]!, subeA: 8,
  },

  // Enviaste y esperás respuesta
  {
    id: 103, estado: 'enviado',
    rival: escalera[4]!, subeA: 5,
  },

  // Agendados
  {
    id: 104, estado: 'agendado',
    rival: escalera[3]!,
    club: 'Signo D Padel', fecha: 'Sáb 13 jun', hora: '20:00', cancha: 'Cancha 2', precio: 9000, subeA: 4,
  },
  {
    id: 105, estado: 'agendado',
    rival: escalera[5]!,
    club: 'La Bombonera Pádel', fecha: 'Dom 14 jun', hora: '10:00', cancha: 'Cancha 1', precio: 7500, subeA: 6,
  },

  // A confirmar resultado
  {
    id: 106, estado: 'a_confirmar',
    rival: escalera[7]!,
    club: 'La Bombonera Pádel', fecha: 'Mié 10 jun', hora: '21:30', cancha: 'Cancha 1',
  },

  // ── HISTORIAL (jugados) ───────────────────────────────────────────────────────

  {
    id: 107, estado: 'jugado',
    rival: escalera[8]!,
    club: 'Signo D Padel', fecha: 'Dom 7 jun', hora: '11:00',
    resultado: { miosSets: 2, rivalSets: 1, gane: true },
  },
  {
    id: 108, estado: 'jugado',
    rival: escalera[5]!,
    club: 'La Bombonera Pádel', fecha: 'Vie 30 may', hora: '20:00',
    resultado: { miosSets: 1, rivalSets: 2, gane: false },
  },
  {
    id: 109, estado: 'jugado',
    rival: escalera[3]!,
    club: 'Pádel Club Salta', fecha: 'Sáb 24 may', hora: '09:30',
    resultado: { miosSets: 2, rivalSets: 0, gane: true },
  },
  {
    id: 110, estado: 'jugado',
    rival: escalera[4]!,
    club: 'Signo D Padel', fecha: 'Mié 21 may', hora: '21:00',
    resultado: { miosSets: 0, rivalSets: 2, gane: false },
  },
  {
    id: 111, estado: 'jugado',
    rival: escalera[7]!,
    club: 'La Bombonera Pádel', fecha: 'Dom 18 may', hora: '11:00',
    resultado: { miosSets: 2, rivalSets: 1, gane: true },
  },
  {
    id: 112, estado: 'jugado',
    rival: escalera[8]!,
    club: 'Pádel Club Salta', fecha: 'Sáb 10 may', hora: '19:00',
    resultado: { miosSets: 2, rivalSets: 0, gane: true },
  },
  {
    id: 113, estado: 'jugado',
    rival: escalera[5]!,
    club: 'Signo D Padel', fecha: 'Vie 2 may', hora: '20:30',
    resultado: { miosSets: 1, rivalSets: 2, gane: false },
  },
  {
    id: 114, estado: 'jugado',
    rival: escalera[3]!,
    club: 'La Bombonera Pádel', fecha: 'Dom 26 abr', hora: '10:00',
    resultado: { miosSets: 2, rivalSets: 1, gane: true },
  },
  {
    id: 115, estado: 'jugado',
    rival: escalera[4]!,
    club: 'Signo D Padel', fecha: 'Sáb 19 abr', hora: '20:00',
    resultado: { miosSets: 0, rivalSets: 2, gane: false },
  },
];

// ── Slots disponibles mock ────────────────────────────────────────────────────
export const slotsDisponibles: SlotMock[] = [
  { hora: '14:00', club: 'Signo D Padel', cancha: 'Cancha 1', precio: 6300, valle: true },
  { hora: '15:30', club: 'Signo D Padel', cancha: 'Cancha 3', precio: 6300, valle: true },
  { hora: '18:00', club: 'La Bombonera Pádel', cancha: 'Cancha 2', precio: 8500 },
  { hora: '19:30', club: 'Signo D Padel', cancha: 'Cancha 2', precio: 9000 },
  { hora: '20:00', club: 'Pádel Club Salta', cancha: 'Cancha 1', precio: 9000 },
  { hora: '21:30', club: 'La Bombonera Pádel', cancha: 'Cancha 1', precio: 9500 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
export function categoriaLabel(c: number): string {
  return `${c}ta`;
}

export function moneda(n: number): string {
  return '$' + n.toLocaleString('es-AR');
}

/** Identidad primaria de la pareja: "Diego R. + Nico F." */
export function parejaLabel(p: Pareja): string {
  return `${p.jugadores[0].nombre} + ${p.jugadores[1].nombre}`;
}

/** Versión con & para títulos: "Diego R. & Nico F." */
export function parejaLabelAnd(p: Pareja): string {
  return `${p.jugadores[0].nombre} & ${p.jugadores[1].nombre}`;
}
