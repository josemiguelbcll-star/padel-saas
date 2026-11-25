import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { useSession } from '@/features/auth';
import type { TurnoCaja } from '@/types/database';
import {
  actividadDelDia,
  clasesPorProfesor,
  resumenManana,
  type ActividadDia,
  type CeldaOcupacion,
  type ClaseProfesorRow,
  type ComoVieneElMes,
  type DiaFacturacion,
  type MapaOcupacion,
  type OcupacionDia,
  type ReservaDiaRow,
} from '../utils/informeDiario';
import {
  agruparCobrosPorMedio,
  calcularArqueoTurno,
  type ArqueoCalculado,
  type CobroTurno,
  type IngresoPorMedioInforme,
  type ProductoVendido,
  type TotalesUnidad,
} from '../utils/informeTurno';
import { fetchCobrosInforme } from './fetchCobrosInforme';
import { fetchDetalleVentas } from './fetchDetalleVentas';
import { horaAMinutos } from '@/features/dashboard/utils/kpisHoy';
import {
  conciliarCobros,
  controlesCuadratura,
  facturadoDelDia,
  ingresoPorHoraDelDia,
  matrizOcupacionDelDia,
  proyeccionCierreMes,
  calcularFugasSpec,
  type ControlFallo,
  type FacturadoDelDia,
  type ReservaSpecRow,
} from '../utils/informeSpec';

export interface JornadaArqueo {
  turno: TurnoCaja;
  arqueo: ArqueoCalculado;
}

export interface InformeDiarioData {
  fecha: string;
  jornada: {
    titulo: string;
    lineas: string[];
  };
  // KPIs grandes (spec §2: Facturado ≠ Cobrado)
  facturacion: number;
  /** Cobrado del día = Σ pagos con fecha de pago = hoy (todos los medios). */
  cobrado: number;
  facturado: FacturadoDelDia;
  conciliacion: ReturnType<typeof conciliarCobros>;
  ocupacion: OcupacionDia;
  mapa: MapaOcupacion | null;
  ingresoHoraDisponible: number | null;
  ingresoHoraOcupada: number | null;
  ingresoHora: ReturnType<typeof ingresoPorHoraDelDia>;
  controles: ControlFallo[];
  pendienteCobro: { count: number; total: number };
  /** Reservas del día con saldo pendiente — para linkear a la grilla. */
  reservasPendientes: Array<{
    id: number;
    cancha_id: number;
    hora_inicio: string;
    saldo: number;
  }>;
  actividad: ActividadDia;
  clasesProfesor: { filas: ClaseProfesorRow[]; total: ClaseProfesorRow };
  porMedio: { items: IngresoPorMedioInforme[]; total: number };
  jornadas: JornadaArqueo[];
  unidades: TotalesUnidad;
  buffetShop: {
    ventas: number;
    margenPct: number | null;
    topProductos: ProductoVendido[];
  };
  facturacion7dias: DiaFacturacion[];
  fugas: ReturnType<typeof calcularFugasSpec>;
  mes: ComoVieneElMes;
  manana: ReturnType<typeof resumenManana> | null;
  pendientesCobroCount: number;
  // Detalle
  cobros: CobroTurno[];
  contexto: {
    reservasCount: number;
    turnosTotales: number;
    clasesCount: number;
    canchasActivas: number;
    horaApertura: string | null;
    horaCierre: string | null;
  };
}

export const INFORME_DIA_QUERY_KEY = (fecha: string | null, clubId?: number) =>
  ['informes', 'dia', fecha, clubId] as const;

function fmtActividadLineas(
  a: ActividadDia,
  ocupacion: OcupacionDia,
): string[] {
  const lineas: string[] = [];
  lineas.push(
    `Mix de horas ocupadas: ${a.turnosFijos.count} fijos · ${a.variables.count} variables · ${a.clases.count} clases.`,
  );
  if (ocupacion.pico) {
    lineas.push(
      `Pico ${ocupacion.pico.etiqueta}: ${Math.round(ocupacion.pico.pct)}% · Valle: ${ocupacion.valle ? `${Math.round(ocupacion.valle.pct)}%` : '—'}.`,
    );
  }
  return lineas;
}

/**
 * Informe diario completo del club para una fecha calendario:
 * facturación, ocupación, actividad, clases por profesor, caja y medios,
 * unidades de negocio, buffet/shop, 7 días, fugas, mes y mañana.
 */
export function useInformeDia(
  fecha: string | null,
): UseQueryResult<InformeDiarioData | null, Error> {
  const { club } = useSession();

  return useQuery<InformeDiarioData | null, Error>({
    queryKey: INFORME_DIA_QUERY_KEY(fecha, club?.id),
    enabled: !!fecha && !!club,
    queryFn: async () => {
      if (!club || !fecha) return null;
      const desdeISO = `${fecha}T00:00:00`;
      const hastaISO = `${fecha}T23:59:59`;

      // ── 1. Jornadas de caja ──────────────────────────────────────
      const { data: turnosRaw, error: turnosErr } = await supabase
        .from('turnos_caja')
        .select('*')
        .eq('club_id', club.id)
        .eq('fecha_jornada', fecha)
        .order('abierta_en', { ascending: true });
      if (turnosErr) throw new Error(mapPostgrestError(turnosErr));
      const turnos = (turnosRaw ?? []) as TurnoCaja[];
      const turnoIds = turnos.map((t) => t.id);

      // ── 2. Datos del día (paralelo) ──────────────────────────────
      const mananaFecha = (() => {
        const d = new Date(`${fecha}T12:00:00`);
        d.setDate(d.getDate() + 1);
        return d.toISOString().slice(0, 10);
      })();

      const [
        raw,
        reservasRes,
        canchasRes,
        clasesRes,
        profesoresRes,
        alumnosHoyRes,
        cobrosMesRes,
        reservas35Res,
        ventas35Res,
        consumosTurno35Res,
        consumosClase35Res,
        reservasMananaRes,
        clubRes,
      ] = await Promise.all([
        fetchCobrosInforme({ desdeISO, hastaISO, usuarioId: null, fecha }),
        supabase
          .from('reservas')
          .select(
            'id, cancha_id, hora_inicio, duracion_min, estado, turno_fijo_id, monto_total, monto_pagado, fecha, observaciones',
          )
          .eq('club_id', club.id)
          .eq('fecha', fecha),
        supabase
          .from('canchas')
          .select('id, nombre, activa')
          .eq('club_id', club.id),
        supabase
          .from('clases')
          .select(
            'id, profesor_id, nombre, duracion_min, dias_semana, activa, es_recurrente, fecha_clase, hora_inicio, cancha_id',
          )
          .eq('club_id', club.id),
        supabase
          .from('profesores')
          .select('id, nombre')
          .eq('club_id', club.id),
        supabase
          .from('clase_ocurrencia_alumnos')
          .select('clase_id, monto_clase')
          .eq('fecha', fecha),
        // Ocurrencias de alumnos: últimas ~5 semanas (alimenta clases del
        // mes Y la serie diaria de facturado para la proyección por día
        // de semana del spec §7).
        supabase
          .from('clase_ocurrencia_alumnos')
          .select('clase_id, fecha, monto_clase')
          .eq('club_id', club.id)
          .gte('fecha', (() => {
            const d = new Date(`${fecha}T12:00:00`);
            d.setDate(d.getDate() - 34);
            return d.toISOString().slice(0, 10);
          })())
          .lte('fecha', fecha),
        // Reservas de las últimas ~5 semanas: serie diaria de Canchas
        // devengado para la proyección por día de semana.
        supabase
          .from('reservas')
          .select(
            'cancha_id, hora_inicio, duracion_min, estado, turno_fijo_id, monto_total, monto_pagado, fecha, observaciones',
          )
          .eq('club_id', club.id)
          .gte('fecha', (() => {
            const d = new Date(`${fecha}T12:00:00`);
            d.setDate(d.getDate() - 34);
            return d.toISOString().slice(0, 10);
          })())
          .lte('fecha', fecha),
        // Ventas POS de las últimas ~5 semanas: serie diaria de
        // Buffet+Shop devengado para la proyección.
        supabase
          .from('ventas')
          .select('fecha_hora, monto_total')
          .eq('club_id', club.id)
          .eq('activa', true)
          .gte('fecha_hora', (() => {
            const d = new Date(`${fecha}T12:00:00`);
            d.setDate(d.getDate() - 34);
            return d.toISOString();
          })())
          .lte('fecha_hora', `${fecha}T23:59:59`),
        // Consumos del turno (35d): devengado por fecha de la RESERVA
        // (no por fecha_hora del consumo, que es la del cobro).
        supabase
          .from('reserva_consumos')
          .select('subtotal, linea, reservas!inner(fecha)')
          .eq('club_id', club.id)
          .gte('reservas.fecha', (() => {
            const d = new Date(`${fecha}T12:00:00`);
            d.setDate(d.getDate() - 34);
            return d.toISOString().slice(0, 10);
          })())
          .lte('reservas.fecha', fecha),
        // Consumos de clase (35d): devengado por `fecha` de la ocurrencia.
        supabase
          .from('clase_consumos')
          .select('subtotal, linea, fecha')
          .eq('club_id', club.id)
          .gte('fecha', (() => {
            const d = new Date(`${fecha}T12:00:00`);
            d.setDate(d.getDate() - 34);
            return d.toISOString().slice(0, 10);
          })())
          .lte('fecha', fecha),
        supabase
          .from('reservas')
          .select(
            'id, cancha_id, hora_inicio, duracion_min, estado, turno_fijo_id, monto_total, monto_pagado, fecha',
          )
          .eq('club_id', club.id)
          .eq('fecha', mananaFecha),
        supabase
          .from('clubes')
          .select('hora_apertura, hora_cierre, nombre')
          .eq('id', club.id)
          .maybeSingle(),
      ]);

      for (const r of [
        reservasRes,
        canchasRes,
        clasesRes,
        profesoresRes,
        alumnosHoyRes,
        cobrosMesRes,
        reservas35Res,
        ventas35Res,
        consumosTurno35Res,
        consumosClase35Res,
        reservasMananaRes,
        clubRes,
      ]) {
        if (r.error) throw new Error(mapPostgrestError(r.error));
      }

      // ── 3. Detalle de ventas (unidades, top, margen, insumos) ────
      const detalle = await fetchDetalleVentas({
        pagosReserva: raw.pagosReserva,
        cobrosClase: raw.cobrosClase,
        ventaIds: raw.ventaIds,
      });
      // Solo cobros ya ocurridos: un pago con fecha futura no cuenta
      // en la facturación del día.
      const ahora = Date.now();
      const cobros = raw.cobros.filter(
        (c) => new Date(c.fecha_hora).getTime() <= ahora,
      );
      const { items, total } = agruparCobrosPorMedio(cobros);

      // ── 4. Reservas / clases / canchas / horarios ────────────────
      const reservas = (reservasRes.data ?? []) as unknown as ReservaDiaRow[];
      const reservasManana = (reservasMananaRes.data ??
        []) as unknown as ReservaDiaRow[];
      const canchas = (canchasRes.data ?? []) as Array<{
        id: number;
        nombre: string;
        activa: boolean;
      }>;
      const clasesCatalogo = (clasesRes.data ?? []) as Array<{
        id: number;
        profesor_id: number | null;
        nombre: string | null;
        duracion_min: number;
        dias_semana: number[];
        activa: boolean;
        es_recurrente: boolean;
        fecha_clase: string | null;
        hora_inicio: string;
        cancha_id: number | null;
      }>;
      const diaSemana = new Date(`${fecha}T12:00:00`).getDay() || 7; // 1=lun..7=dom
      const clasesHoy = clasesCatalogo.filter((c) => {
        if (!c.activa) return false;
        if (c.es_recurrente === false) return c.fecha_clase === fecha;
        return c.dias_semana.includes(diaSemana);
      });
      const clasesHoyIds = new Set(clasesHoy.map((c) => c.id));
      const profesores = (profesoresRes.data ?? []) as Array<{
        id: number;
        nombre: string;
      }>;
      const horarios = clubRes.data as {
        hora_apertura: string | null;
        hora_cierre: string | null;
        nombre: string;
      } | null;

      const alumnosRows = (alumnosHoyRes.data ?? []) as Array<{
        clase_id: number;
        monto_clase: number;
      }>;
      const alumnosHoyPorClase = new Map<number, number>();
      const montoHoyPorClase = new Map<number, number>();
      for (const a of alumnosRows) {
        if (!clasesHoyIds.has(a.clase_id)) continue;
        alumnosHoyPorClase.set(
          a.clase_id,
          (alumnosHoyPorClase.get(a.clase_id) ?? 0) + 1,
        );
        montoHoyPorClase.set(
          a.clase_id,
          (montoHoyPorClase.get(a.clase_id) ?? 0) + Number(a.monto_clase),
        );
      }
      const alumnosClasesHoy = alumnosRows.filter((a) =>
        clasesHoyIds.has(a.clase_id),
      ).length;
      const montoClasesHoy = alumnosRows
        .filter((a) => clasesHoyIds.has(a.clase_id))
        .reduce((acc, a) => acc + Number(a.monto_clase), 0);

      // Ocurrencias del mes por clase (clases dictadas + ingresos).
      const cobrosMesPorClase = new Map<
        number,
        { clases: number; monto: number }
      >();
      const fechasPorClase = new Map<number, Set<string>>();
      for (const c of (cobrosMesRes.data ?? []) as Array<{
        clase_id: number;
        fecha: string;
        monto_clase: number;
      }>) {
        const fechas = fechasPorClase.get(c.clase_id) ?? new Set<string>();
        fechas.add(c.fecha);
        fechasPorClase.set(c.clase_id, fechas);
        cobrosMesPorClase.set(c.clase_id, {
          clases: fechas.size,
          monto:
            (cobrosMesPorClase.get(c.clase_id)?.monto ?? 0) +
            Number(c.monto_clase),
        });
      }

      // ── 5. Matriz única de ocupación (spec §4) + Facturado/Cobrado ──
      const { matriz, mapa: mapaSpec } = matrizOcupacionDelDia({
        reservas: reservas as ReservaSpecRow[],
        clases: clasesHoy,
        canchas,
        horaApertura: horarios?.hora_apertura ?? null,
        horaCierre: horarios?.hora_cierre ?? null,
        diaSemana,
      });
      // Compat: la vista vieja esperaba OcupacionDia/MapaOcupacion; se
      // adaptan desde la matriz para que % total/por cancha/pico/mapa
      // salgan todos de la MISMA fuente (controles C7–C9).
      const ocupacion: OcupacionDia = {
        porcentaje: matriz?.pctTotal ?? null,
        minutosOcupados: matriz ? matriz.celdasOcupadas * 30 : 0,
        minutosDisponibles: matriz ? matriz.celdasDisponibles * 30 : 0,
        pico: matriz?.pico
          ? {
              etiqueta: `${matriz.pico.desde.slice(0, 5)}–${matriz.pico.hasta.slice(0, 5)} h`,
              pct: matriz.pico.pct ?? 0,
            }
          : null,
        valle: null,
      };
      // Mapa compatible con la vista: agrupa las celdas de 30 min en
      // horas (cada celda horaria = sus 1–2 medias horas; prioridad
      // fijo > variable > clase > bloqueo sobre libre).
      const mapa: MapaOcupacion | null = (() => {
        if (!mapaSpec || !horarios?.hora_apertura || !horarios?.hora_cierre) return null;
        const apMin = horaAMinutos(horarios.hora_apertura);
        const ciMin = horaAMinutos(horarios.hora_cierre);
        let cierreAbs = ciMin <= apMin ? ciMin + 1440 : ciMin;
        const horas: number[] = [];
        for (let h = Math.floor(apMin / 60); h < Math.floor(cierreAbs / 60); h++) {
          horas.push(h % 24);
        }
        if (horas.length === 0) return null;
        const celdaHora = (celdas: string[], h: number): CeldaOcupacion => {
          const hIni = h * 60;
          const hFin = hIni + 60;
          const tipos = new Set<string>();
          for (let i = 0; i < celdas.length; i++) {
            const ini = apMin + i * 30;
            if (ini < hFin && ini + 30 > hIni) tipos.add(celdas[i] ?? 'libre');
          }
          if (tipos.has('fijo')) return 'fijo';
          if (tipos.has('variable')) return 'variable';
          if (tipos.has('clase')) return 'clase';
          if (tipos.has('bloqueo')) return 'bloqueo';
          return 'libre';
        };
        return {
          horas,
          canchas: mapaSpec.canchas.map((cm) => {
            const celdas: string[] = [...cm.celdas];
            const porHora = horas.map((h) => celdaHora(celdas, h));
            const ocupadas = porHora.filter((c) => c !== 'libre').length;
            return {
              cancha_id: cm.cancha_id,
              nombre: cm.nombre,
              celdas: porHora,
              ocupacionPct: horas.length > 0 ? (ocupadas / horas.length) * 100 : 0,
            };
          }),
        };
      })();

      // Buffet+Shop DEVENGADO por fecha (spec §3/C3/C11): ventas POS +
      // consumos del turno por fecha de la reserva + consumos de clase
      // por fecha de la ocurrencia. Se usa para el facturado del día Y
      // para la serie del gráfico → la barra de hoy SIEMPRE coincide.
      const buffetPorFecha = new Map<string, number>();
      const sumarBuffet = (f: string, monto: number) =>
        buffetPorFecha.set(f, (buffetPorFecha.get(f) ?? 0) + monto);
      for (const v of (ventas35Res.data ?? []) as Array<{
        fecha_hora: string;
        monto_total: number;
      }>) {
        sumarBuffet(v.fecha_hora.slice(0, 10), Number(v.monto_total));
      }
      for (const c of (consumosTurno35Res.data ?? []) as Array<{
        subtotal: number;
        reservas: { fecha: string } | { fecha: string }[] | null;
      }>) {
        const res = c.reservas;
        const fechaReserva = Array.isArray(res) ? res[0]?.fecha : res?.fecha;
        if (fechaReserva) sumarBuffet(fechaReserva, Number(c.subtotal));
      }
      for (const c of (consumosClase35Res.data ?? []) as Array<{
        subtotal: number;
        fecha: string;
      }>) {
        sumarBuffet(c.fecha, Number(c.subtotal));
      }

      // ── Facturado (devengado) vs Cobrado (percibido) — spec §2/§3 ──
      const facturado = facturadoDelDia({
        reservas: reservas as ReservaSpecRow[],
        montoClasesHoy,
        buffetShopMonto: buffetPorFecha.get(fecha) ?? 0,
      });
      const conciliacion = conciliarCobros({
        cobros: raw.cobros.map((c) => ({
          monto: c.monto,
          fecha_operacion: c.fecha_operacion ?? null,
        })),
        facturadoTotal: facturado.total,
        fecha,
      });
      // Unidades devengadas: Canchas/Escuela del facturado; Buffet/Shop
      // ya vienen devengados de ítems/consumos (C3 por construcción).
      const unidadesDevengado = {
        canchas: facturado.canchas,
        clases: facturado.escuela,
        buffet: detalle.unidades.buffet,
        shop: detalle.unidades.shop,
        total: facturado.total,
      };

      // Ingreso por hora: SOLO Canchas + Escuela (spec §5).
      const canchasActivas = canchas.filter((c) => c.activa).length;
      const horasDisponiblesGlobal =
        horarios?.hora_apertura && horarios?.hora_cierre && canchasActivas > 0
          ? (() => {
              const [ah = 0, am = 0] = horarios.hora_apertura.split(':').map(Number);
              const [ch = 0, cm = 0] = horarios.hora_cierre.split(':').map(Number);
              let mins = ch * 60 + cm - (ah * 60 + am);
              if (mins <= 0) mins += 1440;
              return mins / 60;
            })() * canchasActivas
          : null;
      const ingresoHora = ingresoPorHoraDelDia({
        canchas: facturado.canchas,
        escuela: facturado.escuela,
        matriz,
        horasDisponiblesGlobal,
      });
      const ingresoHoraDisponible = ingresoHora.porHoraDisponible;
      const ingresoHoraOcupada = ingresoHora.porHoraOcupada;

      // ── 6. Actividad ─────────────────────────────────────────────
      // Spec §3: Insumos (tarjeta) = Buffet+Shop = Ventas §6 = una sola
      // fuente devengada (`buffetPorFecha`), no el detalle cobrado.
      const actividad = actividadDelDia({
        reservas,
        clasesHoy,
        alumnosClasesHoy,
        montoClasesHoy,
        insumosUnidades: detalle.insumosUnidades,
        insumosMonto: buffetPorFecha.get(fecha) ?? 0,
      });

      // ── 7. Clases por profesor ───────────────────────────────────
      const clasesProfesor = clasesPorProfesor({
        clases: clasesCatalogo,
        profesores,
        clasesHoyIds,
        alumnosHoyPorClase,
        ingresosHoyPorClase: montoHoyPorClase,
        cobrosMesPorClase,
      });

      // ── 8. Arqueo por jornada ────────────────────────────────────
      const jornadas: JornadaArqueo[] = [];
      if (turnoIds.length > 0) {
        const [efPagosRes, efClasesRes, efVpRes, movsRes] =
          await Promise.all([
            supabase
              .from('reserva_pagos')
              .select('turno_caja_id, monto, tipo')
              .in('turno_caja_id', turnoIds),
            supabase
              .from('clase_cobros')
              .select('turno_caja_id, monto')
              .in('turno_caja_id', turnoIds),
            supabase
              .from('venta_pagos')
              .select('turno_caja_id, monto')
              .in('turno_caja_id', turnoIds),
            supabase
              .from('caja_movimientos_manuales')
              .select('turno_caja_id, tipo, monto')
              .in('turno_caja_id', turnoIds),
          ]);
        for (const r of [efPagosRes, efClasesRes, efVpRes, movsRes]) {
          if (r.error) throw new Error(mapPostgrestError(r.error));
        }
        let ventaEfectivoRows: Array<{
          turno_caja_id: number;
          monto: number;
        }> = [];
        if (!efVpRes.error && efVpRes.data) {
          ventaEfectivoRows = (
            efVpRes.data as Array<{ turno_caja_id: number; monto: number }>
          ).map((v) => ({
            turno_caja_id: v.turno_caja_id,
            monto: Number(v.monto),
          }));
        } else {
          const { data: vRes2 } = await supabase
            .from('ventas')
            .select('turno_caja_id, monto_total')
            .in('turno_caja_id', turnoIds);
          ventaEfectivoRows = (
            (vRes2 ?? []) as Array<{
              turno_caja_id: number;
              monto_total: number;
            }>
          ).map((v) => ({
            turno_caja_id: v.turno_caja_id,
            monto: Number(v.monto_total),
          }));
        }
        const groupBy = <T extends { turno_caja_id: number }>(rows: T[]) => {
          const map = new Map<number, T[]>();
          for (const r of rows) {
            const arr = map.get(r.turno_caja_id) ?? [];
            arr.push(r);
            map.set(r.turno_caja_id, arr);
          }
          return map;
        };
        const pagosBy = groupBy(
          (efPagosRes.data ?? []) as Array<{
            turno_caja_id: number;
            monto: number;
            tipo: string;
          }>,
        );
        const clasesBy = groupBy(
          (efClasesRes.data ?? []) as Array<{
            turno_caja_id: number;
            monto: number;
          }>,
        );
        const ventasBy = groupBy(ventaEfectivoRows);
        const movsBy = groupBy(
          (movsRes.data ?? []) as Array<{
            turno_caja_id: number;
            tipo:
              | 'retiro'
              | 'pago_proveedor'
              | 'ajuste_positivo'
              | 'ajuste_negativo';
            monto: number;
          }>,
        );
        for (const t of turnos) {
          jornadas.push({
            turno: t,
            arqueo: calcularArqueoTurno({
              montoApertura: Number(t.monto_apertura),
              pagosEfectivo: (pagosBy.get(t.id) ?? []).map((p) => ({
                monto: Number(p.monto),
                tipo: p.tipo,
              })),
              cobrosClaseEfectivo: (clasesBy.get(t.id) ?? []).map((c) => ({
                monto: Number(c.monto),
              })),
              ventaPagosEfectivo: (ventasBy.get(t.id) ?? []).map((v) => ({
                monto: Number(v.monto),
              })),
              manuales: movsBy.get(t.id) ?? [],
              efectivoContado:
                t.efectivo_contado === null ? null : Number(t.efectivo_contado),
              diferenciaGuardada:
                t.diferencia === null ? null : Number(t.diferencia),
            }),
          });
        }
      }

      // ── 9. Serie diaria de Facturado (devengado) — spec §7 ──────
      // Canchas desde reservas35; Escuela desde ocurrencias (ventana 35d);
      // Buffet+Shop desde `buffetPorFecha` (ya calculado en §5 con las
      // mismas fuentes devengadas → la barra de hoy = KPI, C11).
      const escuelaPorFecha = new Map<string, number>();
      for (const c of (cobrosMesRes.data ?? []) as Array<{
        fecha: string;
        monto_clase: number;
      }>) {
        escuelaPorFecha.set(
          c.fecha,
          (escuelaPorFecha.get(c.fecha) ?? 0) + Number(c.monto_clase),
        );
      }
      const reservasPorFecha = new Map<string, ReservaSpecRow[]>();
      for (const r of (reservas35Res.data ?? []) as unknown as ReservaSpecRow[]) {
        const arr = reservasPorFecha.get(r.fecha) ?? [];
        arr.push(r);
        reservasPorFecha.set(r.fecha, arr);
      }	
      const facturadoPorFecha = new Map<string, number>();
      const fechasConDatos = new Set<string>([
        ...reservasPorFecha.keys(),
        ...escuelaPorFecha.keys(),
        ...buffetPorFecha.keys(),
      ]);
      for (const f of fechasConDatos) {
        facturadoPorFecha.set(
          f,
          facturadoDelDia({
            reservas: reservasPorFecha.get(f) ?? [],
            montoClasesHoy: escuelaPorFecha.get(f) ?? 0,
            buffetShopMonto: buffetPorFecha.get(f) ?? 0,
          }).total,
        );
      }
      const serieCompleta = [...facturadoPorFecha.entries()]
        .map(([f, v]) => ({ fecha: f, facturado: v }))
        .sort((a, b) => a.fecha.localeCompare(b.fecha));
      const mesActual = fecha.slice(0, 7);
      const serieMes = serieCompleta.filter((s) => s.fecha.slice(0, 7) === mesActual);
      const seriePrevias = serieCompleta.filter((s) => s.fecha.slice(0, 7) !== mesActual);
      const hoy = new Date(`${fecha}T12:00:00`);
      const diasMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
      const proy = proyeccionCierreMes({
        serieMes,
        seriePrevias,
        fecha,
        diasMes,
      });
      const facturacion7dias: DiaFacturacion[] = serieCompleta
        .slice(-7)
        .map((s) => ({ fecha: s.fecha, ingresos: s.facturado }));
      const facturadoMes = proy.facturadoAlDiaN;
      const mes: ComoVieneElMes = {
        facturadoMes,
        facturadoMesAntMismoPeriodo: 0,
        variacionPct: null,
        proyeccionCierre: proy.proyeccionCierre,
        ocupacionMesPct: null,
        proyeccionPorDiaSemana: proy.proyeccionPorDiaSemana,
        mesAnteriorSinDatos: true,
      };

      // ── 10. Fugas + mañana (spec §6) ─────────────────────────────
      const fugas = calcularFugasSpec({
        reservas: reservas as ReservaSpecRow[],
        pendienteHoy: conciliacion.pendienteHoy,
        diferenciasJornadas: jornadas.map((j) => j.arqueo.diferencia),
      });
      const manana = resumenManana({
        reservasManana,
        canchasActivas,
        horaApertura: horarios?.hora_apertura ?? null,
        horaCierre: horarios?.hora_cierre ?? null,
      });

      const reservasPendientes = reservas
        .filter(
          (r) =>
            r.id !== undefined &&
            r.estado !== 'cancelada' &&
            Number(r.monto_total) - Number(r.monto_pagado) > 0,
        )
        .map((r) => ({
          id: r.id as number,
          cancha_id: r.cancha_id,
          hora_inicio: r.hora_inicio,
          saldo: Number(r.monto_total) - Number(r.monto_pagado),
        }));
      const pendientesCount = reservasPendientes.length;

      // ── 11. Controles de cuadratura C1–C12 (spec §8) ─────────────
      const clasesSinAlumnos = clasesHoy.filter(
        (c) => (alumnosHoyPorClase.get(c.id) ?? 0) === 0,
      ).length;
      const controles = controlesCuadratura({
        facturado,
        escuelaTotalDia: facturado.escuela,
        buffetShopUnidades: detalle.unidades.buffet + detalle.unidades.shop,
        ventasSeccion6: buffetPorFecha.get(fecha) ?? 0,
        conciliacion,
        matriz,
        horasTarjetas:
          actividad.turnosFijos.horas +
          actividad.variables.horas +
          actividad.clases.horas,
        suma7dias: facturacion7dias.reduce((a, d) => a + d.ingresos, 0),
        facturadoHoy: facturado.total,
        clasesSinAlumnos,
        mesAnteriorSinDatos: true,
      });

      const lineasEncabezado = fmtActividadLineas(actividad, ocupacion);

      return {
        fecha,
        jornada: {
          titulo: `Cierre del ${new Date(`${fecha}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`,
          lineas: [
            ...lineasEncabezado,
            `${turnos.length} ${turnos.length === 1 ? 'jornada' : 'jornadas'} de caja · ${canchasActivas} canchas · horario ${horarios?.hora_apertura?.slice(0, 5) ?? '—'}–${horarios?.hora_cierre?.slice(0, 5) ?? '—'}`,
          ],
        },
        // Spec §2: "Facturado" = devengado (fecha del turno/venta).
        // El cobrado del día vive en `cobrado`/`conciliacion`.
        facturacion: facturado.total,
        cobrado: conciliacion.cobradoTotal,
        facturado,
        conciliacion,
        ocupacion,
        mapa,
        ingresoHoraDisponible,
        ingresoHoraOcupada,
        ingresoHora,
        pendienteCobro: { count: pendientesCount, total: conciliacion.pendienteHoy },
        reservasPendientes,
        actividad,
        clasesProfesor,
        porMedio: { items, total },
        jornadas,
        unidades: unidadesDevengado,
        controles,
        buffetShop: {
          // Spec C3: "Ventas" sección 6 = insumos devengados =
          // Buffet+Shop del facturado. Una sola fuente.
          ventas: buffetPorFecha.get(fecha) ?? 0,
          margenPct:
            detalle.margenBase > 0
              ? (detalle.margenPositivo / detalle.margenBase) * 100
              : null,
          topProductos: detalle.topProductos,
        },
        facturacion7dias,
        fugas,
        mes,
        manana,
        pendientesCobroCount: pendientesCount,
        cobros,
        contexto: {
          reservasCount: reservas.length,
          turnosTotales: reservas.length + clasesHoy.length,
          clasesCount: clasesHoy.length,
          canchasActivas,
          horaApertura: horarios?.hora_apertura ?? null,
          horaCierre: horarios?.hora_cierre ?? null,
        },
      };
    },
  });
}
