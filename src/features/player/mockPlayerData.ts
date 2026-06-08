/* ============================================================
   MatchGo Player App — Mock data
   TypeScript estricto, sin `any`
   ============================================================ */

// ---------------------------------------------------------------------------
// Jugador logueado
// ---------------------------------------------------------------------------

export const miJugadorApp = {
  id: 'usr-001',
  nombre: 'José Miguel B.',
  nombreCorto: 'José Miguel',
  iniciales: 'JM',
  zona: 'Salta Centro',
  rating: 1482,
  categoria: 6,
  ratingHistorial: [
    { mes: 'Ene', val: 1410 },
    { mes: 'Feb', val: 1430 },
    { mes: 'Mar', val: 1445 },
    { mes: 'Abr', val: 1438 },
    { mes: 'May', val: 1465 },
    { mes: 'Jun', val: 1482 },
  ],
  stats: { pj: 22, pg: 13, pp: 9, horas: 33 },
  logros: [
    { icono: '🏆', texto: '10 victorias seguidas', fecha: 'May 2026' },
    { icono: '📅', texto: '50 partidos jugados',   fecha: 'Abr 2026' },
    { icono: '🔥', texto: '3 desafíos en un mes',  fecha: 'Mar 2026' },
    { icono: '⚡', texto: 'Primera categoría alcanzada', fecha: 'Feb 2026' },
  ],
} as const;

// ---------------------------------------------------------------------------
// Próxima reserva
// ---------------------------------------------------------------------------

export const proximaReserva = {
  id: 'res-042',
  fecha: 'Sáb 13 jun',
  hora: '20:00',
  club: 'Signo D Padel',
  cancha: 'Cancha 2',
  horasRestantes: 36,
} as const;

// ---------------------------------------------------------------------------
// Partido disponible en la red (card suave en Home)
// ---------------------------------------------------------------------------

export const partidoDisponibleEnRed: {
  id: number;
  autor: { nombre: string; iniciales: string };
  fecha: string;
  hora: string;
  club: string;
  libres: number;
} = {
  id: 201,
  autor: { nombre: 'Pedro A.', iniciales: 'PA' },
  fecha: 'Mañana · Dom 8 jun',
  hora: '10:00',
  club: 'La Bombonera Pádel',
  libres: 3,
};

// ---------------------------------------------------------------------------
// Feed de actividad del círculo
// ---------------------------------------------------------------------------

export type FeedTipo = 'victoria' | 'busca_partido' | 'reservo' | 'nuevo_miembro' | 'invitacion';

export interface FeedItem {
  id: number;
  tipo: FeedTipo;
  texto: string;
  hace: string;
}

export const feedActividad: FeedItem[] = [
  { id: 1, tipo: 'busca_partido', texto: 'Pedro A. busca 3 jugadores para el domingo 10hs en La Bombonera', hace: 'hace 30min' },
  { id: 2, tipo: 'victoria',      texto: 'Diego R. + Nico F. ganaron 2-0 a Marcos T. + Juli P.', hace: 'hace 2h' },
  { id: 3, tipo: 'reservo',       texto: 'Ramiro A. reservó cancha en Signo D Padel para el sábado 18hs', hace: 'hace 3h' },
  { id: 4, tipo: 'busca_partido', texto: 'Ana K. + Marcos T. buscan rival para el sáb 20hs en Signo D Padel', hace: 'hace 5h' },
  { id: 5, tipo: 'nuevo_miembro', texto: 'Caro V. se unió a la comunidad MatchGo', hace: 'hace 1d' },
];

// ---------------------------------------------------------------------------
// Clubs disponibles para Explorar
// ---------------------------------------------------------------------------

export interface SlotDisp {
  hora: string;
  cancha: string;
  precio: number;
  valle?: boolean;
}

export interface ClubDisp {
  id: number;
  nombre: string;
  distancia: string;
  rating: number;
  canchas: number;
  slots: SlotDisp[];
}

export const clubsDisponibles: ClubDisp[] = [
  {
    id: 1,
    nombre: 'Signo D Padel',
    distancia: '800m',
    rating: 4.8,
    canchas: 4,
    slots: [
      { hora: '14:00', cancha: 'Cancha 1', precio: 6300, valle: true },
      { hora: '15:30', cancha: 'Cancha 3', precio: 6300, valle: true },
      { hora: '19:30', cancha: 'Cancha 2', precio: 9000 },
      { hora: '20:00', cancha: 'Cancha 1', precio: 9000 },
    ],
  },
  {
    id: 2,
    nombre: 'La Bombonera Pádel',
    distancia: '1.2km',
    rating: 4.6,
    canchas: 3,
    slots: [
      { hora: '18:00', cancha: 'Cancha 2', precio: 8500 },
      { hora: '21:30', cancha: 'Cancha 1', precio: 9500 },
    ],
  },
  {
    id: 3,
    nombre: 'Pádel Club Salta',
    distancia: '2.1km',
    rating: 4.5,
    canchas: 2,
    slots: [
      { hora: '17:00', cancha: 'Cancha 1', precio: 7800, valle: true },
      { hora: '20:00', cancha: 'Cancha 1', precio: 9200 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Ranking semanal de Salta
// ---------------------------------------------------------------------------

export interface JugadorRanking {
  pos: number;
  iniciales: string;
  nombre: string;
  club: string;
  pts: number;
  delta: number; // positivo = subió, negativo = bajó, 0 = igual
  esYo?: boolean;
}

export const rankingSemana = {
  stats: {
    partidos: 76,
    horas: 228,
    clubActivo: 'Signo D Padel',
    rachaLarga: 'Diego R.',
    rachaPartidos: 8,
  },
  jugadores6ta: [
    { pos: 1,  iniciales: 'DR', nombre: 'Diego R.',    club: 'Signo D Padel', pts: 1720, delta:  0 },
    { pos: 2,  iniciales: 'CV', nombre: 'Caro V.',     club: 'Bombonera',     pts: 1685, delta:  1 },
    { pos: 3,  iniciales: 'MT', nombre: 'Marcos T.',   club: 'Signo D Padel', pts: 1610, delta: -1 },
    { pos: 4,  iniciales: 'LB', nombre: 'Lucas B.',    club: 'Pádel Club',    pts: 1560, delta:  2 },
    { pos: 5,  iniciales: 'AC', nombre: 'Ani C.',      club: 'Bombonera',     pts: 1538, delta: -1 },
    { pos: 6,  iniciales: 'TG', nombre: 'Tomi G.',     club: 'Signo D Padel', pts: 1510, delta:  0 },
    { pos: 7,  iniciales: 'JM', nombre: 'José Miguel', club: 'Signo D Padel', pts: 1482, delta:  2, esYo: true },
    { pos: 8,  iniciales: 'EP', nombre: 'Eze P.',      club: 'Bombonera',     pts: 1455, delta: -1 },
    { pos: 9,  iniciales: 'RA', nombre: 'Ramiro A.',   club: 'Pádel Club',    pts: 1420, delta:  1 },
    { pos: 10, iniciales: 'LM', nombre: 'Lauti M.',    club: 'Signo D Padel', pts: 1388, delta: -2 },
  ] as JugadorRanking[],
};

// ---------------------------------------------------------------------------
// Historial de partidos del perfil
// ---------------------------------------------------------------------------

export interface PartidoPerfil {
  id: number;
  fecha: string;
  club: string;
  rival: string;
  resultado: string;
  gane: boolean;
}

// ---------------------------------------------------------------------------
// Tablero comunitario — partidos abiertos (Jugar tab)
// ---------------------------------------------------------------------------

export interface JugadorSlot {
  ocupado: boolean;
  jugador?: { nombre: string; iniciales: string };
}

export interface PartidoAbierto {
  id: number;
  fecha: string;
  hora: string;
  club: string;
  cancha: string;
  nivel: string;
  jugadores: [JugadorSlot, JugadorSlot, JugadorSlot, JugadorSlot];
  creadoPor: string;
  haceCuanto: string;
}

export const partidosAbiertos: PartidoAbierto[] = [
  {
    id: 1,
    fecha: 'Hoy', hora: '19:30',
    club: 'Signo D Padel', cancha: 'Cancha 2',
    nivel: '6ta',
    jugadores: [
      { ocupado: true,  jugador: { nombre: 'Ana K.',    iniciales: 'AK' } },
      { ocupado: true,  jugador: { nombre: 'Marcos T.', iniciales: 'MT' } },
      { ocupado: false },
      { ocupado: false },
    ],
    creadoPor: 'Ana K.', haceCuanto: 'hace 1h',
  },
  {
    id: 2,
    fecha: 'Dom 8 jun', hora: '10:00',
    club: 'La Bombonera Pádel', cancha: 'Cancha 1',
    nivel: 'Abierto',
    jugadores: [
      { ocupado: true,  jugador: { nombre: 'Pedro A.', iniciales: 'PA' } },
      { ocupado: false },
      { ocupado: false },
      { ocupado: false },
    ],
    creadoPor: 'Pedro A.', haceCuanto: 'hace 30min',
  },
  {
    id: 3,
    fecha: 'Sáb 13 jun', hora: '18:00',
    club: 'Pádel Club Salta', cancha: 'Cancha 3',
    nivel: '7ta',
    jugadores: [
      { ocupado: true,  jugador: { nombre: 'Ramiro A.', iniciales: 'RA' } },
      { ocupado: true,  jugador: { nombre: 'Bruno V.',  iniciales: 'BV' } },
      { ocupado: true,  jugador: { nombre: 'Lauti M.',  iniciales: 'LM' } },
      { ocupado: false },
    ],
    creadoPor: 'Ramiro A.', haceCuanto: 'hace 3h',
  },
  {
    id: 4,
    fecha: 'Dom 14 jun', hora: '20:30',
    club: 'Signo D Padel', cancha: 'Cancha 1',
    nivel: '5ta',
    jugadores: [
      { ocupado: true,  jugador: { nombre: 'Diego R.', iniciales: 'DR' } },
      { ocupado: true,  jugador: { nombre: 'Nico F.',  iniciales: 'NF' } },
      { ocupado: false },
      { ocupado: false },
    ],
    creadoPor: 'Diego R.', haceCuanto: 'hace 2h',
  },
];

// ---------------------------------------------------------------------------
// Mis próximas reservas
// ---------------------------------------------------------------------------

export interface MiReserva {
  id: string;
  fecha: string;
  hora: string;
  club: string;
  cancha: string;
  estado: 'confirmada' | 'pendiente';
  jugadoresConfirmados: JugadorSlot[];
}

export const misReservas: MiReserva[] = [
  {
    id: 'res-042',
    fecha: 'Sáb 13 jun', hora: '20:00',
    club: 'Signo D Padel', cancha: 'Cancha 2',
    estado: 'confirmada',
    jugadoresConfirmados: [
      { ocupado: true, jugador: { nombre: 'José Miguel', iniciales: 'JM' } },
      { ocupado: true, jugador: { nombre: 'Pedro A.',    iniciales: 'PA' } },
      { ocupado: false },
      { ocupado: false },
    ],
  },
];

export const historialPerfil: PartidoPerfil[] = [
  { id: 1, fecha: 'Dom 7 jun',  club: 'Signo D Padel', rival: 'Ramiro A. + Bruno V.',  resultado: '2-1', gane: true  },
  { id: 2, fecha: 'Vie 30 may', club: 'Bombonera',     rival: 'Tomi G. + Santi R.',    resultado: '1-2', gane: false },
  { id: 3, fecha: 'Sáb 24 may', club: 'Pádel Club',    rival: 'Lucas B. + Fede M.',    resultado: '2-0', gane: true  },
  { id: 4, fecha: 'Mié 21 may', club: 'Signo D Padel', rival: 'Ani C. + Vale D.',      resultado: '0-2', gane: false },
  { id: 5, fecha: 'Dom 18 may', club: 'Bombonera',     rival: 'Eze P. + Maxi S.',      resultado: '2-1', gane: true  },
];
