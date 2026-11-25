import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import {
  normalizarMedio,
  type CobroTurno,
} from '../utils/informeTurno';

/**
 * Filas crudas de `reserva_pagos` atribuidas al alcance del informe.
 * El hook las reusa para el desglose por unidad (monto_alquiler →
 * Canchas; los consumos entran por reserva_consumos con su `linea`).
 */
export interface PagoReservaRaw {
  reserva_id: number;
  monto_alquiler: number;
  monto_consumo: number;
  tipo: 'sena' | 'pago' | 'reembolso';
}

export interface CobroClaseRaw {
  clase_id: number;
  fecha: string;
  monto: number;
  monto_clase: number | null;
}

export interface CobrosInformeRaw {
  /** Cobros normalizados (reserva + clase + venta + otros_ingresos). */
  cobros: CobroTurno[];
  pagosReserva: PagoReservaRaw[];
  cobrosClase: CobroClaseRaw[];
  /** venta_ids con monto positivo (para traer venta_items/ventas activas). */
  ventaIds: number[];
}

export interface FetchCobrosOptions {
  /** ISO timestamptz lower bound (inclusive). */
  desdeISO: string;
  /** ISO timestamptz upper bound (inclusive). */
  hastaISO: string;
  /**
   * Si se pasa, filtra cobros por `usuario_id` (informe de turno del
   * vendedor). Si es null/undefined, trae TODOS los cobros del club en
   * la ventana (informe de día completo).
   */
  usuarioId?: string | null;
  /**
   * Contexto de turno: si viene `turnoCajaId`, los otros_ingresos se
   * aceptan cuando `turno_caja_id` coincide O su fecha de cobro cae en
   * la ventana. Si viene `fecha` (día completo), se toman los
   * otros_ingresos devengados ese día y cobrados (medio_pago NOT NULL).
   */
  turnoCajaId?: number | null;
  fecha?: string | null;
}

/**
 * Trae y normaliza los cobros del alcance pedido desde las 4 fuentes
 * (reserva_pagos, clase_cobros, venta_pagos con fallback a ventas,
 * otros_ingresos). Las reversiones de venta dentro de la ventana restan.
 */
export async function fetchCobrosInforme(
  opts: FetchCobrosOptions,
): Promise<CobrosInformeRaw> {
  const { desdeISO, hastaISO, usuarioId, turnoCajaId, fecha } = opts;
  const filtrarUsuario = usuarioId != null;

  let pagosQuery = supabase
    .from('reserva_pagos')
    .select(
      `id, reserva_id, monto, medio_pago, cuenta_id, tipo, monto_alquiler, monto_consumo, fecha_hora,
       reservas (fecha, hora_inicio, canchas (nombre))`,
    )
    .gte('fecha_hora', desdeISO)
    .lte('fecha_hora', hastaISO);
  if (filtrarUsuario) pagosQuery = pagosQuery.eq('usuario_id', usuarioId);

  let clasesQuery = supabase
    .from('clase_cobros')
    .select(
      `id, clase_id, fecha, monto, monto_clase, monto_consumo, medio_pago, cuenta_id, fecha_hora,
       clases (nombre)`,
    )
    .gte('fecha_hora', desdeISO)
    .lte('fecha_hora', hastaISO);
  if (filtrarUsuario) clasesQuery = clasesQuery.eq('usuario_id', usuarioId);

  let vpQuery = supabase
    .from('venta_pagos')
    .select(`id, venta_id, monto, medio_pago, cuenta_id, fecha_hora, ventas (observaciones, fecha_hora)`)
    .gte('fecha_hora', desdeISO)
    .lte('fecha_hora', hastaISO);
  if (filtrarUsuario) vpQuery = vpQuery.eq('usuario_id', usuarioId);

  let otrosQuery = supabase
    .from('otros_ingresos')
    .select('id, concepto, monto, medio_pago, fecha, fecha_cobro, turno_caja_id, cuenta_id');
  if (filtrarUsuario) {
    otrosQuery = otrosQuery.eq('usuario_id', usuarioId as string);
  } else if (fecha) {
    otrosQuery = otrosQuery
      .eq('fecha', fecha)
      .not('medio_pago', 'is', null);
  }

  const [pagosRes, clasesRes, vpRes, otrosRes] = await Promise.all([
    pagosQuery,
    clasesQuery,
    vpQuery,
    otrosQuery,
  ]);

  for (const r of [pagosRes, clasesRes, vpRes, otrosRes]) {
    if (r.error) throw new Error(mapPostgrestError(r.error));
  }

  const cobros: CobroTurno[] = [];
  const pagosReserva: PagoReservaRaw[] = [];
  const cobrosClase: CobroClaseRaw[] = [];
  const ventaIdsSet = new Set<number>();

  // ── reserva_pagos ────────────────────────────────────────────────
  type PagoEmbed = {
    id: number;
    reserva_id: number;
    monto: number;
    medio_pago: string;
    cuenta_id: number | null;
    cuenta: { nombre: string } | null;
    tipo: 'sena' | 'pago' | 'reembolso';
    monto_alquiler: number;
    monto_consumo: number;
    fecha_hora: string;
    reservas: {
      fecha: string;
      hora_inicio: string;
      canchas: { nombre: string } | null;
    } | null;
  };
  const pagosRows = (pagosRes.data ?? []) as unknown as PagoEmbed[];
  for (const p of pagosRows) {
    pagosReserva.push({
      reserva_id: p.reserva_id,
      monto_alquiler: Number(p.monto_alquiler),
      monto_consumo: Number(p.monto_consumo),
      tipo: p.tipo,
    });
    const cancha = p.reservas?.canchas?.nombre ?? null;
    const fechaTurno = p.reservas?.fecha
      ? new Date(p.reservas.fecha + 'T00:00:00').toLocaleDateString('es-AR', {
          day: '2-digit',
          month: '2-digit',
        })
      : null;
    const detalle = [
      fechaTurno,
      p.reservas?.hora_inicio?.slice(0, 5),
      cancha,
    ]
      .filter(Boolean)
      .join(' ');
    cobros.push({
      clave: `reserva-${p.id}`,
      origen: 'reserva',
      fecha_hora: p.fecha_hora,
      descripcion:
        (p.tipo === 'sena'
          ? 'Seña reserva'
          : p.tipo === 'reembolso'
            ? 'Reembolso reserva'
            : 'Cobro reserva') + (detalle ? ` · ${detalle}` : ''),
      medio_pago: normalizarMedio(p.medio_pago),
      cuenta_id: p.cuenta_id,
      cuenta_nombre: null,
      monto: (p.tipo === 'reembolso' ? -1 : 1) * Number(p.monto),
      fecha_operacion: p.reservas?.fecha ?? null,
    });
  }

  // ── clase_cobros ─────────────────────────────────────────────────
  type ClaseCobroEmbed = {
    id: number;
    clase_id: number;
    fecha: string;
    monto: number;
    monto_clase: number | null;
    medio_pago: string;
    cuenta_id: number | null;
    cuenta: { nombre: string } | null;
    fecha_hora: string;
    clases: { nombre: string | null } | null;
  };
  const clasesRows = (clasesRes.data ?? []) as unknown as ClaseCobroEmbed[];
  for (const c of clasesRows) {
    cobrosClase.push({
      clase_id: c.clase_id,
      fecha: c.fecha,
      monto: Number(c.monto),
      monto_clase: c.monto_clase === null ? null : Number(c.monto_clase),
    });
    cobros.push({
      clave: `clase-${c.id}`,
      origen: 'clase',
      fecha_hora: c.fecha_hora,
      descripcion: `Cobro clase${c.clases?.nombre ? ` · ${c.clases.nombre}` : ''}`,
      medio_pago: normalizarMedio(c.medio_pago),
      cuenta_id: c.cuenta_id,
      cuenta_nombre: null,
      monto: Number(c.monto),
      fecha_operacion: c.fecha ?? null,
    });
  }

  // ── venta_pagos (con fallback a ventas) ──────────────────────────
  type VpEmbed = {
    id: number;
    venta_id: number;
    monto: number;
    medio_pago: string;
    cuenta_id: number | null;
    cuenta: { nombre: string } | null;
    fecha_hora: string;
    ventas: { observaciones: string | null; fecha_hora: string | null } | null;
  };
  if (!vpRes.error && vpRes.data) {
    const vpRows = vpRes.data as unknown as VpEmbed[];
    for (const v of vpRows) {
      cobros.push({
        clave: `venta-${v.id}`,
        origen: 'venta',
        fecha_hora: v.fecha_hora,
        descripcion: `Venta #${v.venta_id}`,
        medio_pago: normalizarMedio(v.medio_pago),
        cuenta_id: v.cuenta_id,
        cuenta_nombre: null,
        monto: Number(v.monto),
        fecha_operacion: v.ventas?.fecha_hora?.slice(0, 10) ?? null,
      });
      if (Number(v.monto) > 0) ventaIdsSet.add(v.venta_id);
    }

    // Reversiones de esas ventas dentro de la ventana → restan.
    const ventaIds = [...ventaIdsSet];
    if (ventaIds.length > 0) {
      const { data: revs } = await supabase
        .from('venta_pagos_reversiones')
        .select('id, venta_id, monto, medio_pago, fecha_hora')
        .in('venta_id', ventaIds)
        .gte('fecha_hora', desdeISO)
        .lte('fecha_hora', hastaISO);
      for (const rev of (revs ?? []) as Array<{
        id: number;
        venta_id: number;
        monto: number;
        medio_pago: string;
        fecha_hora: string;
      }>) {
        cobros.push({
          clave: `venta-rev-${rev.id}`,
          origen: 'venta',
          fecha_hora: rev.fecha_hora,
          descripcion: `Reversión venta #${rev.venta_id}`,
          medio_pago: normalizarMedio(rev.medio_pago),
          cuenta_id: null,
          cuenta_nombre: null,
          monto: -Number(rev.monto),
        });
      }
    }
  } else {
    // Fallback: tabla `ventas` directamente.
    let vQuery = supabase
      .from('ventas')
      .select('id, monto_total, medio_pago, cuenta_id, fecha_hora, observaciones')
      .eq('activa', true)
      .gte('fecha_hora', desdeISO)
      .lte('fecha_hora', hastaISO);
    if (filtrarUsuario) vQuery = vQuery.eq('usuario_id', usuarioId as string);
    const { data: vRes, error: vErr } = await vQuery;
    if (vErr) throw new Error(mapPostgrestError(vErr));
    for (const v of (vRes ?? []) as Array<{
      id: number;
      monto_total: number;
      medio_pago: string;
      cuenta_id: number | null;
      fecha_hora: string;
    }>) {
      cobros.push({
        clave: `venta-${v.id}`,
        origen: 'venta',
        fecha_hora: v.fecha_hora,
        descripcion: `Venta #${v.id}`,
        medio_pago: normalizarMedio(v.medio_pago),
        cuenta_id: v.cuenta_id,
        cuenta_nombre: null,
        monto: Number(v.monto_total),
        fecha_operacion: v.fecha_hora.slice(0, 10),
      });
      ventaIdsSet.add(v.id);
    }
  }

  // ── otros_ingresos ───────────────────────────────────────────────
  const desdeDate = desdeISO.slice(0, 10);
  const hastaDate = hastaISO.slice(0, 10);
  for (const i of (otrosRes.data ?? []) as Array<{
    id: number;
    concepto: string;
    monto: number;
    medio_pago: string | null;
    fecha: string;
    fecha_cobro: string | null;
    turno_caja_id: number | null;
    cuenta_id: number | null;
    cuenta: { nombre: string } | null;
  }>) {
    let incluir = false;
    if (filtrarUsuario) {
      const esDelTurno = turnoCajaId != null && i.turno_caja_id === turnoCajaId;
      const fechaCobro = (i.fecha_cobro ?? i.fecha ?? '').slice(0, 10);
      const enVentana = fechaCobro >= desdeDate && fechaCobro <= hastaDate;
      incluir = esDelTurno || enVentana;
    } else {
      // Día completo: ya filtrado por fecha devengada + medio_pago NOT NULL.
      incluir = i.medio_pago !== null;
    }
    if (!incluir) continue;
    cobros.push({
      clave: `otro-${i.id}`,
      origen: 'otro_ingreso',
      fecha_hora: i.fecha_cobro ?? `${i.fecha}T12:00:00`,
      descripcion: `Otro ingreso · ${i.concepto}`,
      medio_pago: normalizarMedio(i.medio_pago),
      cuenta_id: i.cuenta_id,
      cuenta_nombre: null,
      monto: Number(i.monto),
      fecha_operacion: (i.fecha_cobro ?? i.fecha ?? '').slice(0, 10) || null,
    });
  }

  const cuentaIds = [
    ...new Set(
      cobros
        .map((cobro) => cobro.cuenta_id)
        .filter((id): id is number => id !== null),
    ),
  ];
  if (cuentaIds.length > 0) {
    const { data: cuentas, error: cuentasErr } = await supabase
      .from('cuentas')
      .select('id, nombre')
      .in('id', cuentaIds);
    if (cuentasErr) throw new Error(mapPostgrestError(cuentasErr));
    const nombresPorId = new Map(
      (cuentas ?? []).map((cuenta) => [cuenta.id, cuenta.nombre]),
    );
    for (const cobro of cobros) {
      if (cobro.cuenta_id !== null) {
        cobro.cuenta_nombre = nombresPorId.get(cobro.cuenta_id) ?? null;
      }
    }
  }

  cobros.sort((a, b) => a.fecha_hora.localeCompare(b.fecha_hora));

  return {
    cobros,
    pagosReserva,
    cobrosClase,
    ventaIds: [...ventaIdsSet],
  };
}
