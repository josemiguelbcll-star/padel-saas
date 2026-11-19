import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { useSession } from '@/features/auth';
import type { TurnoCaja } from '@/types/database';
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

export interface InformeTurnoData {
  turno: TurnoCaja;
  /** Usuario responsable de los "cobros del turno" (vendedor_id en
   *  modalidad por_vendedor; usuario_apertura en por_dia). */
  responsableId: string;
  responsableNombre: string;
  /** Ventana del turno en ISO (abierta_en → cerrada_en ?? ahora). */
  ventanaDesde: string;
  ventanaHasta: string;
  /** Todos los cobros registrados por el responsable en la ventana. */
  cobros: CobroTurno[];
  porMedio: { items: IngresoPorMedioInforme[]; total: number };
  unidades: TotalesUnidad;
  topProductos: ProductoVendido[];
  arqueo: ArqueoCalculado;
}

export const INFORME_TURNO_QUERY_KEY = (turnoId: number | null) =>
  ['informes', 'turno', turnoId] as const;

const AHORA_ISO = () => new Date().toISOString();

/**
 * Informe de una jornada de caja (`turnos_caja`). Devuelve:
 *
 *  - `cobros`: todo lo registrado por el responsable del turno
 *    (`vendedor_id` ?? `usuario_apertura`) dentro de la ventana
 *    abierta_en → cerrada_en, en TODOS los medios de pago.
 *  - `unidades`: desglose Canchas/Clases/Buffet/Shop respetando la
 *    regla de oro (alquiler→canchas, consumo→su linea, clase→clases,
 *    mostrador→su linea).
 *  - `arqueo`: esperado/contado/diferencia de la caja (TODOS los
 *    cobros en efectivo del cajón, no solo los del responsable — en
 *    modalidad por_dia el cajón es compartido).
 */
export function useInformeTurno(
  turnoCajaId: number | null,
): UseQueryResult<InformeTurnoData | null, Error> {
  const { club, user } = useSession();

  return useQuery<InformeTurnoData | null, Error>({
    queryKey: INFORME_TURNO_QUERY_KEY(turnoCajaId),
    enabled: turnoCajaId !== null && !!club && !!user,
    queryFn: async () => {
      if (!club || !user || turnoCajaId === null) return null;

      // ── 1. La jornada ────────────────────────────────────────────
      const { data: turnoRaw, error: turnoErr } = await supabase
        .from('turnos_caja')
        .select('*')
        .eq('id', turnoCajaId)
        .eq('club_id', club.id)
        .maybeSingle();
      if (turnoErr) throw new Error(mapPostgrestError(turnoErr));
      if (!turnoRaw) return null;
      const turno = turnoRaw as TurnoCaja;

      const responsableId = turno.vendedor_id ?? turno.usuario_apertura;
      const ventanaDesde = turno.abierta_en;
      const ventanaHasta = turno.cerrada_en ?? AHORA_ISO();

      // ── 2. Nombre del responsable ────────────────────────────────
      const { data: usuarioRaw } = await supabase
        .from('usuarios')
        .select('id, nombre, email')
        .eq('id', responsableId)
        .maybeSingle();
      const responsableNombre =
        (
          usuarioRaw as { nombre?: string | null; email?: string | null } | null
        )?.nombre?.trim() ||
        (usuarioRaw as { email?: string | null } | null)?.email ||
        'Usuario';

      // ── 3. Cobros del responsable (todos los medios) ─────────────
      const raw = await fetchCobrosInforme({
        desdeISO: ventanaDesde,
        hastaISO: ventanaHasta,
        usuarioId: responsableId,
        turnoCajaId,
      });
      const { cobros, pagosReserva, cobrosClase } = raw;

      // ── 4. Unidades de negocio + top productos ───────────────────
      const { unidades, topProductos } = await fetchDetalleVentas({
        pagosReserva,
        cobrosClase,
        ventaIds: raw.ventaIds,
      });

      // ── 5. Arqueo de la caja (todo el cajón — en por_dia es
      //    compartido, no solo lo del responsable) ──────────────────
      const [efPagosRes, efClasesRes, efVpRes, movsRes] = await Promise.all([
        supabase
          .from('reserva_pagos')
          .select('monto, tipo')
          .eq('turno_caja_id', turnoCajaId)
          .eq('medio_pago', 'efectivo'),
        supabase
          .from('clase_cobros')
          .select('monto')
          .eq('turno_caja_id', turnoCajaId)
          .eq('medio_pago', 'efectivo'),
        supabase
          .from('venta_pagos')
          .select('monto')
          .eq('turno_caja_id', turnoCajaId)
          .eq('medio_pago', 'efectivo'),
        supabase
          .from('caja_movimientos_manuales')
          .select('tipo, monto')
          .eq('turno_caja_id', turnoCajaId),
      ]);
      for (const r of [efPagosRes, efClasesRes, efVpRes, movsRes]) {
        if (r.error) throw new Error(mapPostgrestError(r.error));
      }

      // Fallback venta_pagos → ventas (mismo criterio que useResumenCajaAbierta).
      let ventaPagosEfectivo: Array<{ monto: number }> = [];
      if (!efVpRes.error && efVpRes.data) {
        ventaPagosEfectivo = (efVpRes.data as Array<{ monto: number }>).map(
          (v) => ({ monto: Number(v.monto) }),
        );
      } else {
        const { data: vRes2 } = await supabase
          .from('ventas')
          .select('monto_total')
          .eq('turno_caja_id', turnoCajaId)
          .eq('medio_pago', 'efectivo');
        ventaPagosEfectivo = (
          (vRes2 ?? []) as Array<{ monto_total: number }>
        ).map((v) => ({ monto: Number(v.monto_total) }));
      }

      const arqueo = calcularArqueoTurno({
        montoApertura: Number(turno.monto_apertura),
        pagosEfectivo: (efPagosRes.data ?? []) as Array<{
          monto: number;
          tipo: string;
        }>,
        cobrosClaseEfectivo: (efClasesRes.data ?? []) as Array<{
          monto: number;
        }>,
        ventaPagosEfectivo,
        manuales: (movsRes.data ?? []) as Array<{
          tipo:
            | 'retiro'
            | 'pago_proveedor'
            | 'ajuste_positivo'
            | 'ajuste_negativo';
          monto: number;
        }>,
        efectivoContado:
          turno.efectivo_contado === null
            ? null
            : Number(turno.efectivo_contado),
        diferenciaGuardada:
          turno.diferencia === null ? null : Number(turno.diferencia),
      });

      const { items, total } = agruparCobrosPorMedio(cobros);

      return {
        turno,
        responsableId,
        responsableNombre,
        ventanaDesde,
        ventanaHasta,
        cobros,
        porMedio: { items, total },
        unidades,
        topProductos,
        arqueo,
      };
    },
  });
}
