/**
 * Lógica PURA del "informe diario del dueño" según la Especificación de
 * cálculos (docx del dueño, Nov-2026). Sin Supabase ni React.
 *
 * Principios del spec que acá se respetan:
 *  - Facturado (devengado, fecha del turno/venta) ≠ Cobrado (percibido,
 *    fecha del pago). Son dos KPIs separados.
 *  - Una sola matriz de ocupación de 30 min × cancha alimenta % total,
 *    % por cancha, pico y mapa → todos los números cuadran (C7–C9).
 *  - Unidades de negocio en devengado: Canchas = fijos + variables +
 *    cargos por cancelación; Escuela = clases; Buffet/Shop = ítems.
 *  - Ingreso por hora usa SOLO Canchas + Escuela (nunca buffet/shop).
 *  - Controles de cuadratura C1–C12 → alertas "Datos a revisar".
 */
import { horaAMinutos } from '@/features/dashboard/utils/kpisHoy';
import type { EstadoReserva } from '@/types/database';

// ── Tipos de entrada ────────────────────────────────────────────────

export interface ReservaSpecRow {
  /** Presente en las filas reales; opcional para fixtures. */
  id?: number;
  cancha_id: number;
  hora_inicio: string;
  duracion_min: number;
  estado: EstadoReserva;
  turno_fijo_id: number | null;
  monto_total: number;
  monto_pagado: number;
  /** 'YYYY-MM-DD' — necesario para la serie diaria de facturado. */
  fecha: string;
  /** Para detectar bloqueos (torneo/mantenimiento). */
  observaciones?: string | null;
}

export interface CanchaSpecRow {
  id: number;
  nombre: string;
  activa: boolean;
}

/** Cobro normalizado con la fecha de la OPERACIÓN que cancela. */
export interface CobroSpec {
  monto: number; // con signo
  fecha_operacion: string | null; // 'YYYY-MM-DD' o null si no se sabe
}

// ── Helpers de estado ───────────────────────────────────────────────

/** Estados que ocupan cancha y facturan (spec: "jugada" equivale a firme). */
function esFirme(estado: EstadoReserva): boolean {
  return estado === 'pendiente' || estado === 'senada' || estado === 'pagada' || estado === 'jugada';
}

function esBloqueo(r: ReservaSpecRow): boolean {
  const obs = (r.observaciones ?? '').toLowerCase();
  return obs.includes('bloqueo') || obs.includes('mantenimiento') || obs.includes('torneo');
}

function esCancelada(r: ReservaSpecRow): boolean {
  return r.estado === 'cancelada';
}

// ── 1 · Facturado vs Cobrado (sección 2 del spec) ───────────────────

export interface FacturadoDelDia {
  /** Σ monto_total de reservas firmes tipo fijo. */
  canchasFijos: number;
  /** Σ monto_total de reservas firmes tipo variable. */
  canchasVariables: number;
  /** Σ monto_pagado de reservas canceladas con cargo. */
  cargosCancelacion: number;
  /** canchasFijos + canchasVariables + cargosCancelacion. */
  canchas: number;
  /** Σ monto_clase de las ocurrencias de clase del día. */
  escuela: number;
  /** Buffet + Shop facturado (ítems/consumos del día). */
  buffetShop: number;
  /** Canchas + Escuela + Buffet/Shop = Facturado del día. */
  total: number;
}

export function facturadoDelDia(input: {
  reservas: ReservaSpecRow[];
  montoClasesHoy: number;
  buffetShopMonto: number;
}): FacturadoDelDia {
  let fijos = 0;
  let variables = 0;
  let cargos = 0;
  for (const r of input.reservas) {
    // Bloqueo SIN cargo (mantenimiento puro, $0) no factura ni ocupa venta.
    // Bloqueo CON monto (torneo/evento pago) SÍ es ingreso real → cuenta.
    if (esBloqueo(r) && !(Number(r.monto_total) > 0)) continue;
    if (esFirme(r.estado)) {
      if (r.turno_fijo_id !== null) fijos += Number(r.monto_total) || 0;
      else variables += Number(r.monto_total) || 0;
    } else if (esCancelada(r) && Number(r.monto_pagado) > 0) {
      cargos += Number(r.monto_pagado) || 0;
    }
  }
  const canchas = fijos + variables + cargos;
  const escuela = Number(input.montoClasesHoy) || 0;
  const buffetShop = Number(input.buffetShopMonto) || 0;
  return {
    canchasFijos: fijos,
    canchasVariables: variables,
    cargosCancelacion: cargos,
    canchas,
    escuela,
    buffetShop,
    total: canchas + escuela + buffetShop,
  };
}

export interface ConciliacionCobros {
  /** A: cobros de operaciones de HOY. */
  operacionesHoy: number;
  /** B: cobros de deudas de días anteriores. */
  deudasAnteriores: number;
  /** C: señas/pagos anticipados de operaciones futuras. */
  anticiposFuturos: number;
  /** D: el resto sin fecha de operación clara (cuotas, ajustes). */
  otros: number;
  /** Cobrado del día = A+B+C+D (todos los cobros con fecha pago = hoy). */
  cobradoTotal: number;
  /** Pendiente de cobro de hoy = Facturado − A (spec paso 4). */
  pendienteHoy: number;
}

export function conciliarCobros(input: {
  cobros: CobroSpec[];
  facturadoTotal: number;
  fecha: string;
}): ConciliacionCobros {
  let a = 0;
  let b = 0;
  let c = 0;
  let d = 0;
  for (const cob of input.cobros) {
    const op = cob.fecha_operacion;
    if (op === null) d += cob.monto;
    else if (op === input.fecha) a += cob.monto;
    else if (op < input.fecha) b += cob.monto;
    else c += cob.monto;
  }
  return {
    operacionesHoy: a,
    deudasAnteriores: b,
    anticiposFuturos: c,
    otros: d,
    cobradoTotal: a + b + c + d,
    pendienteHoy: Math.max(0, input.facturadoTotal - a),
  };
}

// ── 2 · Matriz única de ocupación (sección 4 del spec) ───────────────

export type TipoCelda = 'fijo' | 'variable' | 'clase' | 'bloqueo' | 'libre';

export interface MatrizOcupacion {
  /** Franjas de 30 min dentro de la ventana apertura→cierre. */
  franjas: number;
  /** Celdas totales = franjas × canchas activas. */
  celdasTotal: number;
  /** Celdas ocupadas (fijo+variable+clase). */
  celdasOcupadas: number;
  /** Celdas en bloqueo (mantenimiento/torneo) → NO disponibles. */
  celdasBloqueo: number;
  /** celdasTotal − celdasBloqueo. */
  celdasDisponibles: number;
  /** ocupadas / disponibles (%). null si no hay ventana. */
  pctTotal: number | null;
  /** % por cancha (misma base). */
  pctPorCancha: Array<{ cancha_id: number; pct: number | null }>;
  /** Minutos ocupados por tipo (alimenta las tarjetas y C7). */
  minutosPorTipo: { fijo: number; variable: number; clase: number; bloqueo: number };
  /** Pico: ventana fija configurable por día de semana. */
  pico: { desde: string; hasta: string; pct: number | null } | null;
}

export interface MapaCelda {
  tipo: TipoCelda;
}

export interface MapaOcupacionSpec {
  /** Etiquetas de franja 'HH:MM' (inicio de cada media hora). */
  franjas: string[];
  canchas: Array<{
    cancha_id: number;
    nombre: string;
    celdas: TipoCelda[];
  }>;
}

const MIN_Franja = 30;

/**
 * Ventana pico por defecto del spec: L–V 15:00–21:00, S–D 10:00–16:00.
 * (El spec la quiere configurable por día de semana; no hay config en DB,
 *  así que va hardcodeada como default razonable — se puede mover a
 *  `clubes`/config más adelante.)
 */
export function ventanaPicoPorDia(diaSemana: number): { desde: string; hasta: string } {
  // diaSemana ISO: 1=lun … 7=dom
  if (diaSemana >= 6) return { desde: '10:00', hasta: '16:00' };
  return { desde: '15:00', hasta: '21:00' };
}

export function matrizOcupacionDelDia(input: {
  reservas: ReservaSpecRow[];
  clases: Array<{ cancha_id: number | null; hora_inicio: string; duracion_min: number }>;
  canchas: CanchaSpecRow[];
  horaApertura: string | null;
  horaCierre: string | null;
  diaSemana: number;
}): { matriz: MatrizOcupacion | null; mapa: MapaOcupacionSpec | null } {
  const canchasActivas = input.canchas.filter((c) => c.activa);
  const apertura = input.horaApertura ? horaAMinutos(input.horaApertura) : null;
  const cierre = input.horaCierre ? horaAMinutos(input.horaCierre) : null;

  if (apertura === null || cierre === null || canchasActivas.length === 0) {
    return { matriz: null, mapa: null };
  }
  let cierreAbs = cierre;
  if (cierreAbs <= apertura) cierreAbs += 1440;
  const ventanaMin = cierreAbs - apertura;
  if (ventanaMin <= 0) return { matriz: null, mapa: null };

  const franjas = Math.ceil(ventanaMin / MIN_Franja);
  const inicioFranja = (i: number) => apertura + i * MIN_Franja;
  const finFranja = (i: number) => inicioFranja(i) + MIN_Franja;

  // Matriz[cellsIdx] por cancha
  const celdasPorCancha = new Map<number, TipoCelda[]>();
  for (const c of canchasActivas) {
    celdasPorCancha.set(c.id, new Array<TipoCelda>(franjas).fill('libre'));
  }

  const solapa = (iniMin: number, durMin: number, i: number): boolean => {
    // iniMin puede ser >=1440 si cruza medianoche? hora_inicio es TIME < 24h.
    return iniMin < finFranja(i) && iniMin + durMin > inicioFranja(i);
  };

  // Reservas
  for (const r of input.reservas) {
    if (!celdasPorCancha.has(r.cancha_id)) continue;
    const ini = horaAMinutos(r.hora_inicio);
    // reservas que cruzan medianoche: hora_fin implícita
    let dur = r.duracion_min;
    if (ini + dur > 1440) dur = 1440 - ini; // recortar a fin del día
    if (esBloqueo(r)) {
      marcar(r.cancha_id, ini, Math.min(dur, ventanaMin), 'bloqueo');
      continue;
    }
    if (esFirme(r.estado)) {
      marcar(r.cancha_id, ini, dur, r.turno_fijo_id !== null ? 'fijo' : 'variable');
    }
    // canceladas → quedan libres (spec)
  }
  // Clases (prioridad sobre libre; si pisa reserva firme, la reserva ya marcó —
  // el spec dice "una franja tiene un único tipo"; clase gana si no hay reserva)
  for (const cl of input.clases) {
    if (cl.cancha_id === null || cl.cancha_id === undefined) continue;
    const cells = celdasPorCancha.get(cl.cancha_id);
    if (!cells) continue;
    const ini = horaAMinutos(cl.hora_inicio);
    for (let i = 0; i < franjas; i++) {
      if (solapa(ini, cl.duracion_min, i) && cells[i] === 'libre') cells[i] = 'clase';
    }
  }

  function marcar(canchaId: number, iniMin: number, durMin: number, tipo: TipoCelda): void {
    const cells = celdasPorCancha.get(canchaId);
    if (!cells) return;
    // Si la reserva arranca antes de la apertura, igual pinta desde su inicio real
    for (let i = 0; i < franjas; i++) {
      if (solapa(iniMin, durMin, i)) cells[i] = tipo;
    }
  }

  // ── Agregados ──
  let ocupadas = 0;
  let bloqueadas = 0;
  const minutosPorTipo = { fijo: 0, variable: 0, clase: 0, bloqueo: 0 };
  const pctPorCancha: MatrizOcupacion['pctPorCancha'] = [];

  for (const c of canchasActivas) {
    const cells = celdasPorCancha.get(c.id) ?? [];
    let o = 0;
    let b = 0;
    for (const t of cells) {
      if (t === 'fijo' || t === 'variable' || t === 'clase') {
        ocupadas++;
        o++;
        minutosPorTipo[t] += MIN_Franja;
      } else if (t === 'bloqueo') {
        bloqueadas++;
        b++;
        minutosPorTipo.bloqueo += MIN_Franja;
      }
    }
    const disponiblesCancha = franjas - b;
    pctPorCancha.push({
      cancha_id: c.id,
      pct: disponiblesCancha > 0 ? (o / disponiblesCancha) * 100 : null,
    });
  }

  const celdasTotal = franjas * canchasActivas.length;
  const celdasDisponibles = celdasTotal - bloqueadas;
  const pctTotal = celdasDisponibles > 0 ? (ocupadas / celdasDisponibles) * 100 : null;

  // Pico: ventana fija por día de semana, sobre la matriz.
  const picoConf = ventanaPicoPorDia(input.diaSemana);
  const picoIniMin = horaAMinutos(picoConf.desde);
  const picoFinMin = horaAMinutos(picoConf.hasta);
  let picoOcupadas = 0;
  let picoTotal = 0;
  for (let i = 0; i < franjas; i++) {
    const ini = inicioFranja(i);
    // celda del pico si su centro cae dentro de la ventana
    const centro = ini + MIN_Franja / 2;
    const dentro = centro >= picoIniMin && centro < picoFinMin;
    if (!dentro) continue;
    picoTotal += canchasActivas.length;
    for (const c of canchasActivas) {
      const t = celdasPorCancha.get(c.id)?.[i];
      if (t === 'fijo' || t === 'variable' || t === 'clase') picoOcupadas++;
    }
  }
  const pico =
    picoTotal > 0
      ? {
          desde: picoConf.desde,
          hasta: picoConf.hasta,
          pct: (picoOcupadas / picoTotal) * 100,
        }
      : null;

  const matriz: MatrizOcupacion = {
    franjas,
    celdasTotal,
    celdasOcupadas: ocupadas,
    celdasBloqueo: bloqueadas,
    celdasDisponibles,
    pctTotal,
    pctPorCancha,
    minutosPorTipo,
    pico,
  };

  // Mapa: mismas celdas de 30 min (la vista puede agrupar de a 2 por hora).
  const nombrePorId = new Map(input.canchas.map((c) => [c.id, c.nombre]));
  const etiquetasFranjas: string[] = [];
  for (let i = 0; i < franjas; i++) {
    const mins = inicioFranja(i);
    const hh = Math.floor(mins / 60) % 24;
    const mm = mins % 60;
    etiquetasFranjas.push(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
  }
  const mapa: MapaOcupacionSpec = {
    franjas: etiquetasFranjas,
    canchas: canchasActivas.map((c) => ({
      cancha_id: c.id,
      nombre: nombrePorId.get(c.id) ?? `Cancha ${c.id}`,
      celdas: celdasPorCancha.get(c.id) ?? [],
    })),
  };

  return { matriz, mapa };
}

// ── 3 · Ingreso por hora (sección 5 del spec) ───────────────────────

export interface IngresoPorHora {
  /** Canchas + Escuela (devengado). NUNCA buffet/shop. */
  ingresoCancha: number;
  horasDisponibles: number | null;
  horasOcupadas: number;
  porHoraDisponible: number | null;
  porHoraOcupada: number | null;
  /** Canchas / horas de fijos+variables (alquiler puro). */
  porHoraAlquilada: number | null;
}

export function ingresoPorHoraDelDia(input: {
  canchas: number;
  escuela: number;
  matriz: MatrizOcupacion | null;
  horasDisponiblesGlobal: number | null; // respaldo si no hay matriz
}): IngresoPorHora {
  const ingresoCancha = input.canchas + input.escuela;
  const horasOcupadas = input.matriz
    ? (input.matriz.celdasOcupadas * MIN_Franja) / 60
    : 0;
  const horasDisponibles = input.matriz
    ? (input.matriz.celdasDisponibles * MIN_Franja) / 60
    : input.horasDisponiblesGlobal;
  const horasAlquilada =
    input.matriz !== null
      ? ((input.matriz.minutosPorTipo.fijo + input.matriz.minutosPorTipo.variable) * 1) / 60
      : null;
  return {
    ingresoCancha,
    horasDisponibles,
    horasOcupadas,
    porHoraDisponible:
      horasDisponibles && horasDisponibles > 0 ? ingresoCancha / horasDisponibles : null,
    porHoraOcupada: horasOcupadas > 0 ? ingresoCancha / horasOcupadas : null,
    porHoraAlquilada:
      horasAlquilada && horasAlquilada > 0 && input.canchas > 0
        ? input.canchas / horasAlquilada
        : null,
  };
}

// ── 4 · Fugas de plata (sección 6 del spec) ──────────────────────────

export interface FugasSpec {
  /** Cobros incompletos = pendiente de cobro de hoy (+ deuda vieja, §2). */
  cobrosIncompletos: { total: number };
  cancelaciones: {
    conCargo: { count: number; monto: number };
    reasignadas: { count: number; monto: number };
    perdidas: { count: number; monto: number };
  };
  noShow: { count: number; monto: number };
  diferenciasArqueo: { count: number; total: number };
  totalRiesgo: number;
}

export function calcularFugasSpec(input: {
  reservas: ReservaSpecRow[];
  pendienteHoy: number;
  diferenciasJornadas: Array<number | null>;
}): FugasSpec {
  const canceladas = input.reservas.filter(esCancelada);
  let conCargoN = 0;
  let conCargoM = 0;
  let perdidasN = 0;
  let perdidasM = 0;
  for (const r of canceladas) {
    const pagado = Number(r.monto_pagado) || 0;
    const total = Number(r.monto_total) || 0;
    if (pagado > 0) {
      conCargoN++;
      conCargoM += pagado;
      // si pagó menos que el total, la diferencia se perdió
      if (total - pagado > 0) {
        perdidasN++;
        perdidasM += total - pagado;
      }
    } else {
      perdidasN++;
      perdidasM += total;
    }
  }
  // reasignadas: no hay flag en el modelo → 0 (el spec las quiere informativas)
  const difs = input.diferenciasJornadas.filter(
    (d): d is number => d !== null && d !== 0,
  );
  const diferenciasTotal = difs.reduce((a, d) => a + d, 0);
  const totalRiesgo =
    input.pendienteHoy + perdidasM + Math.abs(diferenciasTotal);
  return {
    cobrosIncompletos: { total: input.pendienteHoy },
    cancelaciones: {
      conCargo: { count: conCargoN, monto: conCargoM },
      reasignadas: { count: 0, monto: 0 },
      perdidas: { count: perdidasN, monto: perdidasM },
    },
    noShow: { count: 0, monto: 0 },
    diferenciasArqueo: { count: difs.length, total: diferenciasTotal },
    totalRiesgo,
  };
}

// ── 5 · Mes: proyección por día de semana (sección 7 del spec) ───────

export interface DiaFacturadoSerie {
  fecha: string; // 'YYYY-MM-DD'
  facturado: number;
}

export interface ProyeccionMes {
  facturadoAlDiaN: number;
  proyeccionCierre: number | null;
  /** Promedio por día de semana usado (para mostrar el método). */
  proyeccionPorDiaSemana: boolean;
}

/**
 * Proyección de cierre por día de semana (spec §7):
 * para cada día de la semana restante del mes, promedia el facturado de
 * los días ya cerrados de ESE día de semana en el mes; si hay <2 muestras
 * usa las últimas 4 semanas (serie diaria provista por el caller).
 */
export function proyeccionCierreMes(input: {
  /** Serie diaria de facturado del mes hasta hoy (día 1..N). */
  serieMes: DiaFacturadoSerie[];
  /** Serie diaria de facturado de las ~5 semanas previas (para fallback <2 muestras). */
  seriePrevias: DiaFacturadoSerie[];
  fecha: string; // día N
  diasMes: number;
}): ProyeccionMes {
  const [y, m] = input.fecha.split('-').map(Number);
  const diaN = Number(input.fecha.slice(8, 10));
  const facturadoAlDiaN = input.serieMes.reduce((a, d) => a + d.facturado, 0);

  // Mapa fecha→facturado de ambas series
  const porFecha = new Map<string, number>();
  for (const d of [...input.seriePrevias, ...input.serieMes]) {
    porFecha.set(d.fecha, (porFecha.get(d.fecha) ?? 0) + d.facturado);
  }

  let proyeccion = facturadoAlDiaN;
  let usadoPorSemana = false;
  const dow = (f: string) => new Date(`${f}T12:00:00`).getDay() || 7; // 1..7

  for (let d = diaN + 1; d <= input.diasMes; d++) {
    const fechaDia = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dowDia = dow(fechaDia);
    // muestras del mismo día de semana ya cerradas EN EL MES
    let suma = 0;
    let n = 0;
    for (const s of input.serieMes) {
      if (dow(s.fecha) === dowDia) {
        suma += s.facturado;
        n++;
      }
    }
    if (n < 2) {
      // fallback: últimas 4 semanas (mismo dow, fechas < inicio del mes)
      let suma4 = 0;
      let n4 = 0;
      const inicioMes = `${y}-${String(m).padStart(2, '0')}-01`;
      for (const s of input.seriePrevias) {
        if (s.fecha < inicioMes && dow(s.fecha) === dowDia) {
          suma4 += s.facturado;
          n4++;
        }
      }
      if (n4 > 0) {
        suma = suma4;
        n = n4;
        usadoPorSemana = true;
      }
    }
    proyeccion += n > 0 ? suma / n : 0;
  }

  return {
    facturadoAlDiaN,
    proyeccionCierre: proyeccion,
    proyeccionPorDiaSemana: usadoPorSemana,
  };
}

// ── 6 · Controles de cuadratura C1–C12 (spec §8) ─────────────────────

export interface ControlFallo {
  codigo: string;
  texto: string;
  /** id de sección destino para la alerta clickeable. */
  destino?: string;
}

export function controlesCuadratura(input: {
  facturado: FacturadoDelDia;
  escuelaTotalDia: number;
  /** Σ unidades.buffet+shop (ítems/consumos) debe igualar facturado.buffetShop. */
  buffetShopUnidades: number;
  ventasSeccion6: number;
  conciliacion: ConciliacionCobros;
  matriz: MatrizOcupacion | null;
  /** Horas de fijos+variables+clases según tarjetas (minutos/60). */
  horasTarjetas: number;
  /** Suma del gráfico de 7 días. */
  suma7dias: number;
  facturadoHoy: number;
  /** Clases de hoy con 0 alumnos. */
  clasesSinAlumnos: number;
  /** "Mes anterior" venía en 0 por falta de datos históricos. */
  mesAnteriorSinDatos?: boolean;
}): ControlFallo[] {
  const fallos: ControlFallo[] = [];
  const dif = (a: number, b: number) => Math.abs(a - b);

  // C1: fijos + variables + cargos = canchas
  const c1 = input.facturado.canchasFijos + input.facturado.canchasVariables + input.facturado.cargosCancelacion;
  if (dif(c1, input.facturado.canchas) > 0.01) {
    fallos.push({ codigo: 'C1', texto: `Canchas no cuadra: fijos+variables+cargos difieren en $${c1 - input.facturado.canchas}.` });
  }
  // C2: escuela por profesor = escuela (se verifica en la vista; acá solo si difiere el total)
  if (dif(input.escuelaTotalDia, input.facturado.escuela) > 0.01) {
    fallos.push({ codigo: 'C2', texto: `Escuela no cuadra con la tabla por profesor (Δ $${input.escuelaTotalDia - input.facturado.escuela}).` });
  }
  // C3: insumos = buffet+shop = ventas sección 6
  if (dif(input.buffetShopUnidades, input.facturado.buffetShop) > 0.01) {
    fallos.push({ codigo: 'C3', texto: `Buffet+Shop (ítems) difiere del facturado en $${input.buffetShopUnidades - input.facturado.buffetShop}.` });
  }
  if (dif(input.facturado.buffetShop, input.ventasSeccion6) > 0.01) {
    fallos.push({ codigo: 'C3b', texto: `Ventas sección 6 difiere de Buffet+Shop en $${input.ventasSeccion6 - input.facturado.buffetShop}.` });
  }
  // C4: canchas+escuela+buffetshop = facturado
  if (dif(input.facturado.total, input.facturado.canchas + input.facturado.escuela + input.facturado.buffetShop) > 0.01) {
    fallos.push({ codigo: 'C4', texto: 'Facturado del día no es igual a Canchas+Escuela+Buffet/Shop.' });
  }
  // C5: Σ medios = cobrado
  if (dif(input.conciliacion.cobradoTotal, input.conciliacion.operacionesHoy + input.conciliacion.deudasAnteriores + input.conciliacion.anticiposFuturos + input.conciliacion.otros) > 0.01) {
    fallos.push({ codigo: 'C5', texto: 'La suma de medios de cobro no coincide con el cobrado del día.' });
  }
  // C6: cobrado = A+B+C+D
  if (dif(input.conciliacion.cobradoTotal, input.conciliacion.operacionesHoy + input.conciliacion.deudasAnteriores + input.conciliacion.anticiposFuturos + input.conciliacion.otros) > 0.01) {
    fallos.push({ codigo: 'C6', texto: 'Cobrado ≠ A+B+C+D (conciliación incompleta).' });
  }
  // C7: horas tarjetas = horas matriz
  if (input.matriz) {
    const horasMatriz = (input.matriz.minutosPorTipo.fijo + input.matriz.minutosPorTipo.variable + input.matriz.minutosPorTipo.clase) / 60;
    if (Math.abs(horasMatriz - input.horasTarjetas) > 0.01) {
      fallos.push({ codigo: 'C7', texto: `Horas de tarjetas (${input.horasTarjetas}h) ≠ matriz (${horasMatriz}h).` });
    }
    // C8: Σ por cancha = total
    const sumaPorCancha = input.matriz.pctPorCancha.reduce((a, p) => a + (p.pct ?? 0), 0);
    if (input.matriz.pctPorCancha.length > 0 && input.matriz.pctTotal !== null) {
      const promPorCancha = sumaPorCancha / input.matriz.pctPorCancha.length;
      if (Math.abs(promPorCancha - input.matriz.pctTotal) > 5) {
        fallos.push({ codigo: 'C8', texto: '% por cancha no promedia al % total.' });
      }
    }
    // C9: pico viene de la matriz (nada que comparar — se expone para la vista)
  }
  // C10: Σ 7 días ≤ facturado del mes (si aplica — el caller decide)
  // C11: barra de hoy = facturado — lo valida el caller
  // C12: clases con 0 alumnos
  if (input.clasesSinAlumnos > 0) {
    fallos.push({ codigo: 'C12', texto: `${input.clasesSinAlumnos} clase(s) de hoy sin alumnos (cancha ocupada sin ingreso).` });
  }
  if (input.mesAnteriorSinDatos) {
    fallos.push({ codigo: 'C13', texto: 'Sin datos del mismo período del mes anterior: la variación se oculta.' });
  }
  const DESTINO: Record<string, string> = {
    C1: 'sec-actividad',
    C2: 'sec-clases',
    C3: 'sec-buffet',
    C3b: 'sec-buffet',
    C4: 'sec-unidades',
    C5: 'sec-fugas',
    C6: 'sec-fugas',
    C7: 'sec-mapa',
    C8: 'sec-mapa',
    C9: 'sec-mapa',
    C12: 'sec-clases',
    C13: 'sec-mes',
  };
  for (const f of fallos) f.destino = DESTINO[f.codigo];
  return fallos;
}
