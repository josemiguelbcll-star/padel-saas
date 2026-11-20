import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { useSession } from '@/features/auth';
import type { TurnoCaja } from '@/types/database';
import {
  actividadDelDia,
  calcularFugas,
  clasesPorProfesor,
  comoVieneElMes,
  ocupacionDelDia,
  resumenManana,
  type ActividadDia,
  type ClaseProfesorRow,
  type ComoVieneElMes,
  type DiaFacturacion,
  type Fugas,
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
  // KPIs grandes
  facturacion: number;
  ocupacion: OcupacionDia;
  mapa: MapaOcupacion | null;
  ingresoHoraDisponible: number | null;
  ingresoHoraOcupada: number | null;
  pendienteCobro: { count: number; total: number };
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
  fugas: Fugas;
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
        reservasMananaRes,
        flujo7Res,
        flujoMesRes,
        flujoMesAntRes,
        clubRes,
      ] = await Promise.all([
        fetchCobrosInforme({ desdeISO, hastaISO, usuarioId: null, fecha }),
        supabase
          .from('reservas')
          .select(
            'id, cancha_id, hora_inicio, duracion_min, estado, turno_fijo_id, monto_total, monto_pagado, fecha',
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
        // Ocurrencias de alumnos del mes en curso (clases dictadas +
        // ingresos por profesor — fuente real del ingreso por clase).
        supabase
          .from('clase_ocurrencia_alumnos')
          .select('clase_id, fecha, monto_clase')
          .eq('club_id', club.id)
          .gte('fecha', `${fecha.slice(0, 7)}-01`)
          .lte('fecha', fecha),
        supabase
          .from('reservas')
          .select(
            'id, cancha_id, hora_inicio, duracion_min, estado, turno_fijo_id, monto_total, monto_pagado, fecha',
          )
          .eq('club_id', club.id)
          .eq('fecha', mananaFecha),
        supabase.rpc('fn_flujo_caja', {
          p_desde: (() => {
            const d = new Date(`${fecha}T12:00:00`);
            d.setDate(d.getDate() - 6);
            return d.toISOString().slice(0, 10);
          })(),
          p_hasta: fecha,
          p_granularidad: 'day',
          p_cuenta_id: null,
        }),
        supabase.rpc('fn_flujo_caja', {
          p_desde: `${fecha.slice(0, 7)}-01`,
          p_hasta: fecha,
          p_granularidad: 'month',
          p_cuenta_id: null,
        }),
        supabase.rpc('fn_flujo_caja', {
          p_desde: (() => {
            const parts = fecha.split('-').map(Number);
            const y = parts[0] ?? 0;
            const m = parts[1] ?? 1;
            const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
            return `${prev.y}-${String(prev.m).padStart(2, '0')}-01`;
          })(),
          p_hasta: (() => {
            const parts = fecha.split('-').map(Number);
            const y = parts[0] ?? 0;
            const m = parts[1] ?? 1;
            const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
            const lastDay = new Date(prev.y, prev.m, 0).getDate();
            const dia = Math.min(Number(fecha.slice(8, 10)), lastDay);
            return `${prev.y}-${String(prev.m).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
          })(),
          p_granularidad: 'month',
          p_cuenta_id: null,
        }),
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
        reservasMananaRes,
        flujo7Res,
        flujoMesRes,
        flujoMesAntRes,
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

      // ── 5. Ocupación + mapa ──────────────────────────────────────
      const { ocupacion, mapa } = ocupacionDelDia({
        reservas,
        clasesHoy,
        canchas,
        horaApertura: horarios?.hora_apertura ?? null,
        horaCierre: horarios?.hora_cierre ?? null,
      });

      // Ingreso por hora disponible / ocupada (canchas + clases cobradas).
      const canchasActivas = canchas.filter((c) => c.activa).length;
      const horasDisponibles =
        horarios?.hora_apertura && horarios?.hora_cierre && canchasActivas > 0
          ? (() => {
              const [ah = 0, am = 0] = horarios.hora_apertura.split(':').map(Number);
              const [ch = 0, cm = 0] = horarios.hora_cierre.split(':').map(Number);
              let mins = ch * 60 + cm - (ah * 60 + am);
              if (mins <= 0) mins += 1440;
              return mins / 60;
            })() * canchasActivas
          : null;
      const ingresoHoraBase = detalle.unidades.canchas + detalle.unidades.clases;
      const horasOcupadas = ocupacion.minutosOcupados / 60;
      const ingresoHoraDisponible =
        horasDisponibles && horasDisponibles > 0
          ? ingresoHoraBase / horasDisponibles
          : null;
      const ingresoHoraOcupada =
        horasOcupadas > 0 ? ingresoHoraBase / horasOcupadas : null;

      // ── 6. Actividad ─────────────────────────────────────────────
      const actividad = actividadDelDia({
        reservas,
        clasesHoy,
        alumnosClasesHoy,
        montoClasesHoy,
        insumosUnidades: detalle.insumosUnidades,
        insumosMonto: detalle.insumosMonto,
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

      // ── 9. Facturación 7 días + mes ──────────────────────────────
      type FlujoRow = {
        periodo: string;
        ingresos: number | string;
      };
      const facturacion7dias: DiaFacturacion[] = (
        (flujo7Res.data ?? []) as unknown as FlujoRow[]
      ).map((r) => ({ fecha: r.periodo, ingresos: Number(r.ingresos) }));

      const facturadoMes = (
        ((flujoMesRes.data ?? []) as unknown as FlujoRow[]).reduce(
          (a, r) => a + Number(r.ingresos),
          0,
        )
      );
      const facturadoMesAnt = (
        ((flujoMesAntRes.data ?? []) as unknown as FlujoRow[]).reduce(
          (a, r) => a + Number(r.ingresos),
          0,
        )
      );
      const hoy = new Date(`${fecha}T12:00:00`);
      const mes = comoVieneElMes({
        facturadoMes,
        facturadoMesAntMismoPeriodo: facturadoMesAnt,
        diasTranscurridos: hoy.getDate(),
        diasMes: new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate(),
        ocupacionMesPct: null,
      });

      // ── 10. Fugas + mañana ───────────────────────────────────────
      const fugas = calcularFugas({
        reservas,
        diferenciasJornadas: jornadas.map((j) => j.arqueo.diferencia),
      });
      const manana = resumenManana({
        reservasManana,
        canchasActivas,
        horaApertura: horarios?.hora_apertura ?? null,
        horaCierre: horarios?.hora_cierre ?? null,
      });

      const pendientesCount = reservas.filter(
        (r) =>
          r.estado !== 'cancelada' &&
          Number(r.monto_total) - Number(r.monto_pagado) > 0,
      ).length;

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
        facturacion: total,
        ocupacion,
        mapa,
        ingresoHoraDisponible,
        ingresoHoraOcupada,
        pendienteCobro: fugas.pendienteCobro,
        actividad,
        clasesProfesor,
        porMedio: { items, total },
        jornadas,
        unidades: detalle.unidades,
        buffetShop: {
          ventas: detalle.margenBase,
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
