import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { CondicionPago, Tarifa, TurnoFijo } from '@/types/database';
import type { ClaseConProfesor } from '@/features/configuracion/hooks/useClases';
import {
  calcularProyeccionTurnosFijos,
  calcularProyeccionReservasSueltas,
  type ReservaMinima,
} from '../utils/calcularProyeccionTurnosFijos';
import {
  calcularProyeccionClases,
  type CobroClaseMinimo,
} from '../utils/calcularProyeccionClases';
import {
  clavePeriodo,
  enumerarMeses,
  enumerarPeriodos,
  hoyISO,
  ultimoDiaMes,
  type Granularidad,
} from '../utils/clavePeriodo';
import { useCuentasPorPagar } from './useCuentasPorPagar';
import { useGastosRecurrentes } from './useGastosRecurrentes';

// ─────────────────────────────────────────────────────────────────────
// Tipos del retorno
// ─────────────────────────────────────────────────────────────────────

export interface FlujoProyectadoPeriodo {
  /** Clave de período (inicio ISO) — MISMA que fn_flujo_caja. */
  periodo: string;
  ingresos: number;
  egresos: number;
  neto: number;
}

export interface FlujoProyectado {
  /** Una fila por período del rango (continuo), con compromisos DATEADOS. */
  porPeriodo: FlujoProyectadoPeriodo[];
  /** Compromisos SIN fecha comprometida → bloque informativo, FUERA de la curva. */
  sinFecha: {
    cuotasSinVencimiento: number;
    ocPendientes: number;
  };
  /** Cuotas pendientes con vencimiento < hoy (sumadas al primer período). */
  vencido: number;
  /** true en day/week: la proyección fina de ingresos es aproximada
   *  (solo reservas materializadas futuras dateadas; la proyección completa
   *  de ingresos vive en la vista mensual). */
  ingresosAproximados: boolean;
}

export interface UseFlujoProyectadoResult {
  data: FlujoProyectado | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

// ─────────────────────────────────────────────────────────────────────
// Datos de ingresos del rango (mismas 6 fuentes que useProyeccionAlquileres,
// pero acotadas a [desde, hasta] en vez de un solo mes).
// ─────────────────────────────────────────────────────────────────────

interface IngresosData {
  turnosFijos: TurnoFijo[];
  reservas: ReservaMinima[];
  tarifas: Tarifa[];
  clases: ClaseConProfesor[];
  cobros: CobroClaseMinimo[];
  tarifasClases: Tarifa[];
}

function useIngresosData(desde: string, hasta: string) {
  return useQuery<IngresosData, Error>({
    queryKey: ['flujo-proyectado-ingresos', desde, hasta],
    queryFn: async () => {
      const [turnosFijosRes, reservasRes, tarifasRes, clasesRes, cobrosRes, tarifasClasesRes] =
        await Promise.all([
          supabase
            .from('turnos_fijos')
            .select(
              'id, club_id, cancha_id, jugador_id, nombre_libre, dia_semana, hora_inicio, duracion_min, fecha_desde, fecha_hasta, activo, observaciones, usuario_alta_id, fecha_alta',
            )
            .eq('activo', true),
          supabase
            .from('reservas')
            .select('id, turno_fijo_id, fecha, estado, monto_total, monto_pagado')
            .gte('fecha', desde)
            .lte('fecha', hasta),
          supabase.from('tarifas').select('*'),
          supabase
            .from('clases')
            .select('*, profesor:profesor_id(nombre)')
            .eq('activa', true),
          supabase
            .from('clase_cobros')
            .select('clase_id, fecha, monto')
            .gte('fecha', desde)
            .lte('fecha', hasta),
          supabase.from('tarifas_clases').select('*'),
        ]);

      for (const r of [
        turnosFijosRes,
        reservasRes,
        tarifasRes,
        clasesRes,
        cobrosRes,
        tarifasClasesRes,
      ]) {
        if (r.error) throw new Error(mapPostgrestError(r.error));
      }

      return {
        turnosFijos: (turnosFijosRes.data ?? []) as TurnoFijo[],
        reservas: (reservasRes.data ?? []) as ReservaMinima[],
        tarifas: (tarifasRes.data ?? []) as Tarifa[],
        clases: (clasesRes.data ?? []) as unknown as ClaseConProfesor[],
        cobros: (cobrosRes.data ?? []) as CobroClaseMinimo[],
        tarifasClases: (tarifasClasesRes.data ?? []) as Tarifa[],
      };
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// OC pendientes (compras estado='pedida'). En 'pedida' el monto vive en
// monto_neto_oc (monto_total es NULL hasta recibir). condicion_pago/
// fecha_compromiso_pago se traen para una eventual mejora (ver hook doc).
// ─────────────────────────────────────────────────────────────────────

interface OcPendiente {
  condicion_pago: CondicionPago;
  fecha_compromiso_pago: string | null;
  monto_neto_oc: number;
}

function useOcPendientes() {
  return useQuery<OcPendiente[], Error>({
    queryKey: ['flujo-proyectado-oc-pendientes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('compras')
        .select('condicion_pago, fecha_compromiso_pago, monto_neto_oc')
        .eq('estado', 'pedida');
      if (error) throw new Error(mapPostgrestError(error));
      return ((data ?? []) as unknown as Array<{
        condicion_pago: CondicionPago;
        fecha_compromiso_pago: string | null;
        monto_neto_oc: number;
      }>).map((r) => ({
        condicion_pago: r.condicion_pago,
        fecha_compromiso_pago: r.fecha_compromiso_pago,
        monto_neto_oc: Number(r.monto_neto_oc),
      }));
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// Hook principal
// ─────────────────────────────────────────────────────────────────────

/**
 * MITAD PROYECTADA del flujo de caja: compromisos futuros DATEADOS, bucketeados
 * con las MISMAS claves de período que fn_flujo_caja (clavePeriodo). Se combina
 * con useFlujoCaja (real) en la vista, SIEMPRE diferenciados visualmente
 * (real = sólido / proyectado = punteado): nunca se mezclan numéricamente.
 *
 * EGRESOS (dateados con precisión):
 *  - Cuotas de CxP pendientes (useCuentasPorPagar): con fecha_vencimiento →
 *    su período; vencidas (< hoy) → primer período + contador `vencido`;
 *    sin fecha → sinFecha.cuotasSinVencimiento.
 *  - Recurrentes (useGastosRecurrentes) con DEDUP de 3 vías: por mes, si la
 *    plantilla YA tiene un real cargado ese mes (plantilla.reales) NO se
 *    proyecta (el real ya está: pendiente → su cuota vino por CxP; pagado →
 *    está en el flujo REAL). Evita doble conteo contra cuotas y contra lo real.
 *  - OC pendientes → sinFecha.ocPendientes (monto_neto_oc). Ver nota ↓.
 *
 * INGRESOS:
 *  - 'month': proyección completa (calcularProyeccionTurnosFijos +
 *    calcularProyeccionClases + reservas sueltas) por mes del rango, sobre las
 *    funciones puras. Solo meses >= mes actual (el pasado lo cubre el flujo real).
 *  - 'day'/'week': solo reservas materializadas futuras dateadas (falta_cobrar);
 *    ingresosAproximados=true (la proyección fina de no-materializadas es mensual).
 *
 * NOTA OC: hoy todas las OC pendientes van a sinFecha (decisión tomada). Las OC
 * con condicion_pago='a_plazo' tienen fecha_compromiso_pago (fecha comprometida
 * REAL, no estimada) → se podrían datear en la curva sin inventar nada. Quedó
 * marcado como posible mejora; por eso el query ya trae esos campos.
 */
export function useFlujoProyectado(
  desde: string,
  hasta: string,
  granularidad: Granularidad,
): UseFlujoProyectadoResult {
  const cxpQuery = useCuentasPorPagar();
  const recurrentesQuery = useGastosRecurrentes();
  const ingresosQuery = useIngresosData(desde, hasta);
  const ocQuery = useOcPendientes();

  const data = useMemo<FlujoProyectado | undefined>(() => {
    const cuotas = cxpQuery.data;
    const recurrentes = recurrentesQuery.data;
    const ingresos = ingresosQuery.data;
    const ocs = ocQuery.data;
    if (!cuotas || !recurrentes || !ingresos || !ocs) return undefined;

    const periodos = enumerarPeriodos(desde, hasta, granularidad);
    const ingresosAproximados = granularidad !== 'month';

    if (periodos.length === 0) {
      return {
        porPeriodo: [],
        sinFecha: { cuotasSinVencimiento: 0, ocPendientes: 0 },
        vencido: 0,
        ingresosAproximados,
      };
    }

    const primerPeriodo = periodos[0] as string;
    const ultimoPeriodo = periodos[periodos.length - 1] as string;
    const enRango = (p: string) => p >= primerPeriodo && p <= ultimoPeriodo;

    const ingresosMap = new Map<string, number>();
    const egresosMap = new Map<string, number>();
    const acumular = (map: Map<string, number>, key: string, val: number) =>
      map.set(key, (map.get(key) ?? 0) + val);

    let cuotasSinVencimiento = 0;
    let ocPendientes = 0;
    let vencido = 0;

    const hoy = hoyISO();
    const mesActualKey = clavePeriodo(hoy, 'month'); // 'YYYY-MM-01'
    const meses = enumerarMeses(desde, hasta);

    // ── EGRESOS: cuotas de CxP ─────────────────────────────────────────
    for (const c of cuotas) {
      if (c.fecha_vencimiento === null) {
        cuotasSinVencimiento += c.monto;
        continue;
      }
      if (c.fecha_vencimiento < hoy) {
        // Vencida y aún pendiente: pesa en el primer período + contador.
        acumular(egresosMap, primerPeriodo, c.monto);
        vencido += c.monto;
        continue;
      }
      const p = clavePeriodo(c.fecha_vencimiento, granularidad);
      if (enRango(p)) acumular(egresosMap, p, c.monto);
      // Más allá del horizonte → fuera de la ventana (v1).
    }

    // ── EGRESOS: recurrentes (con DEDUP) ───────────────────────────────
    for (const plantilla of recurrentes) {
      for (const M of meses) {
        if (M.firstISO < mesActualKey) continue; // mes pasado → lo cubre lo real
        // DEDUP: ¿ya hay un real ACTIVO de esta plantilla en el mes M?
        const hayReal = plantilla.reales.some(
          (r) => r.fecha_gasto.slice(0, 7) === M.mKey,
        );
        if (hayReal) continue;
        const diaVenc = Math.min(plantilla.dia_vencimiento, ultimoDiaMes(M.anio, M.mes));
        const fechaVenc = `${M.mKey}-${String(diaVenc).padStart(2, '0')}`;
        let p = clavePeriodo(fechaVenc, granularidad);
        if (p < primerPeriodo) p = primerPeriodo; // venc ya pasó este mes → 1er período
        if (enRango(p)) acumular(egresosMap, p, plantilla.monto_estimado);
      }
    }

    // ── EGRESOS: OC pendientes ─────────────────────────────────────────
    // a_plazo → fecha_compromiso_pago es una fecha PACTADA (CHECK 0041), no
    // estimada → va a la curva (vencida < hoy → primer período + contador
    // `vencido`, igual criterio que las cuotas vencidas). al_dia/al_recibir →
    // sin fecha comprometida → bloque informativo sinFecha. Sin doble conteo:
    // una OC 'pedida' no tiene cuotas todavía (se generan al recibir, y ahí
    // deja de ser 'pedida'). Monto = monto_neto_oc (monto_total es NULL hasta
    // recibir).
    for (const oc of ocs) {
      if (oc.condicion_pago === 'a_plazo' && oc.fecha_compromiso_pago !== null) {
        if (oc.fecha_compromiso_pago < hoy) {
          acumular(egresosMap, primerPeriodo, oc.monto_neto_oc);
          vencido += oc.monto_neto_oc;
          continue;
        }
        const p = clavePeriodo(oc.fecha_compromiso_pago, granularidad);
        if (enRango(p)) acumular(egresosMap, p, oc.monto_neto_oc);
        // Más allá del horizonte → fuera de la ventana (v1), igual que cuotas.
        continue;
      }
      // al_dia / al_recibir: sin fecha comprometida → informativo.
      ocPendientes += oc.monto_neto_oc;
    }

    // ── INGRESOS ───────────────────────────────────────────────────────
    if (granularidad === 'month') {
      for (const M of meses) {
        if (M.firstISO < mesActualKey) continue; // el pasado lo cubre lo real
        const reservasDeM = ingresos.reservas.filter(
          (r) => r.fecha.slice(0, 7) === M.mKey,
        );
        const cobrosDeM = ingresos.cobros.filter(
          (c) => c.fecha.slice(0, 7) === M.mKey,
        );
        const tf = calcularProyeccionTurnosFijos({
          anio: M.anio,
          mes: M.mes,
          turnosFijos: ingresos.turnosFijos,
          reservasDelMes: reservasDeM,
          tarifas: ingresos.tarifas,
        });
        const cls = calcularProyeccionClases({
          anio: M.anio,
          mes: M.mes,
          clases: ingresos.clases,
          cobrosDelMes: cobrosDeM,
          tarifasClases: ingresos.tarifasClases,
        });
        const sueltas = calcularProyeccionReservasSueltas(reservasDeM);
        const falta = tf.falta_cobrar + cls.falta_cobrar + sueltas.falta_cobrar;
        const p = clavePeriodo(M.firstISO, 'month');
        if (enRango(p) && falta > 0) acumular(ingresosMap, p, falta);
      }
    } else {
      // day/week: solo reservas materializadas FUTURAS dateadas (aproximado).
      for (const r of ingresos.reservas) {
        if (r.fecha < hoy) continue;
        if (r.estado !== 'pendiente' && r.estado !== 'senada') continue;
        const falta = Math.max(0, (Number(r.monto_total) || 0) - (Number(r.monto_pagado) || 0));
        if (falta <= 0) continue;
        const p = clavePeriodo(r.fecha, granularidad);
        if (enRango(p)) acumular(ingresosMap, p, falta);
      }
    }

    const porPeriodo: FlujoProyectadoPeriodo[] = periodos.map((p) => {
      const ing = ingresosMap.get(p) ?? 0;
      const egr = egresosMap.get(p) ?? 0;
      return { periodo: p, ingresos: ing, egresos: egr, neto: ing - egr };
    });

    return {
      porPeriodo,
      sinFecha: { cuotasSinVencimiento, ocPendientes },
      vencido,
      ingresosAproximados,
    };
  }, [
    cxpQuery.data,
    recurrentesQuery.data,
    ingresosQuery.data,
    ocQuery.data,
    desde,
    hasta,
    granularidad,
  ]);

  return {
    data,
    isLoading:
      cxpQuery.isLoading ||
      recurrentesQuery.isLoading ||
      ingresosQuery.isLoading ||
      ocQuery.isLoading,
    isError:
      cxpQuery.isError || recurrentesQuery.isError || ingresosQuery.isError || ocQuery.isError,
    error:
      cxpQuery.error ??
      recurrentesQuery.error ??
      ingresosQuery.error ??
      ocQuery.error ??
      null,
  };
}
