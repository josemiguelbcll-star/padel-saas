import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { TipoMovimientoCaja } from '@/types/database';

/**
 * Categorías visibles en la lista de movimientos de la caja. Distinguen
 * el origen (cobro de qué tabla, o manual) y el tipo dentro de cada uno.
 */
export type CategoriaMovimientoCaja =
  | 'cobro_reserva_pago'
  | 'cobro_reserva_sena'
  | 'cobro_reserva_reembolso'
  | 'cobro_venta'
  | 'cobro_clase'
  | 'manual_retiro'
  | 'manual_pago_proveedor'
  | 'manual_ajuste_positivo'
  | 'manual_ajuste_negativo';

/**
 * Movimiento individual de la caja del día — incluye TANTO los cobros
 * en efectivo (de reservas, buffet, clases) COMO los movimientos
 * manuales (retiros, pagos a proveedor, ajustes). Pensado para
 * auditar la jornada cronológicamente: si al cierre falta plata, esta
 * lista permite rastrear cuándo y por qué entró/salió cada peso.
 */
export interface MovimientoCajaUnificado {
  /** Clave única (combina prefijo + id de la fila original). */
  id: string;
  categoria: CategoriaMovimientoCaja;
  fecha_hora: string;
  /** Siempre positivo; el signo lo da `signo`. */
  monto: number;
  signo: '+' | '-';
  /** Título visible (ej. "Cobro reserva (pago)", "Retiro de caja"). */
  descripcion: string;
  /** Info adicional debajo del título (ej. "21/05 15:30 · Cancha 1"). */
  detalle: string | null;
  /** Id de la fila original (para futura navegación al detalle). */
  origen_id: number;
}

export const CAJA_MOVIMIENTOS_QUERY_KEY = (turnoCajaId: number) =>
  ['caja', 'movimientos', turnoCajaId] as const;

const fechaCortaFmt = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
});

function formatearHoraTime(hhmmss: string | null | undefined): string {
  if (!hhmmss) return '';
  // 'HH:MM:SS' o 'HH:MM' → 'HH:MM'
  return hhmmss.slice(0, 5);
}

/**
 * Lista cronológica (DESC — más reciente primero) de TODOS los
 * movimientos de la caja: cobros en efectivo + movimientos manuales.
 *
 * Hace 4 queries paralelas con embeds para traer info contextual
 * (reservas → cancha; clases → nombre). Si los embeds tiraran 400
 * en algún entorno, se podrían reemplazar por queries separadas.
 *
 * Solo cobros en efectivo (medio_pago='efectivo'). Los cobros por
 * transferencia/MP/tarjeta NO entran a la caja (regla de oro).
 */
export function useMovimientosCaja(
  turnoCajaId: number | null,
): UseQueryResult<MovimientoCajaUnificado[], Error> {
  return useQuery<MovimientoCajaUnificado[], Error>({
    queryKey: turnoCajaId
      ? CAJA_MOVIMIENTOS_QUERY_KEY(turnoCajaId)
      : ['caja', 'movimientos', 'null'],
    enabled: turnoCajaId !== null,
    // staleTime bajo + refetch on focus: cuando el operador vuelve
    // a la pestaña de caja después de cobrar en otra pantalla, la
    // lista se actualiza sola.
    staleTime: 5_000,
    queryFn: async () => {
      if (!turnoCajaId) return [];

      const [pagosRes, ventasRes, clasesRes, manualesRes] = await Promise.all([
        supabase
          .from('reserva_pagos')
          .select(
            `
            id, monto, tipo, fecha_hora,
            reservas (fecha, hora_inicio, canchas (nombre))
            `,
          )
          .eq('turno_caja_id', turnoCajaId)
          .eq('medio_pago', 'efectivo'),
        supabase
          .from('ventas')
          .select('id, monto_total, fecha_hora, observaciones')
          .eq('turno_caja_id', turnoCajaId)
          .eq('medio_pago', 'efectivo'),
        supabase
          .from('clase_cobros')
          .select(
            `
            id, monto, fecha, fecha_hora, observaciones,
            clases (nombre)
            `,
          )
          .eq('turno_caja_id', turnoCajaId)
          .eq('medio_pago', 'efectivo'),
        supabase
          .from('caja_movimientos_manuales')
          .select('id, tipo, monto, concepto, observaciones, fecha_hora')
          .eq('turno_caja_id', turnoCajaId),
      ]);

      for (const r of [pagosRes, ventasRes, clasesRes, manualesRes]) {
        if (r.error) throw new Error(mapPostgrestError(r.error));
      }

      const unificados: MovimientoCajaUnificado[] = [];

      // ── Cobros de reservas (con info de turno: fecha, hora, cancha) ─
      type PagoEmbed = {
        id: number;
        monto: number;
        tipo: 'sena' | 'pago' | 'reembolso';
        fecha_hora: string;
        reservas: {
          fecha: string;
          hora_inicio: string;
          canchas: { nombre: string } | null;
        } | null;
      };
      // `as unknown as X` — supabase-js infiere los embeds como arrays
      // pero en runtime devuelve objeto cuando la FK es many-to-one
      // (cada pago tiene UNA reserva, cada reserva UNA cancha). Patrón
      // estándar del codebase (ver SessionProvider para casos similares).
      for (const p of (pagosRes.data ?? []) as unknown as PagoEmbed[]) {
        const cancha = p.reservas?.canchas?.nombre ?? null;
        const fechaTurno = p.reservas?.fecha
          ? fechaCortaFmt.format(new Date(p.reservas.fecha + 'T00:00:00'))
          : null;
        const horaTurno = formatearHoraTime(p.reservas?.hora_inicio);
        const detalle = [
          fechaTurno && horaTurno ? `${fechaTurno} ${horaTurno}` : null,
          cancha,
        ]
          .filter(Boolean)
          .join(' · ');

        const categoria =
          p.tipo === 'sena'
            ? 'cobro_reserva_sena'
            : p.tipo === 'reembolso'
              ? 'cobro_reserva_reembolso'
              : 'cobro_reserva_pago';
        const descripcion =
          p.tipo === 'sena'
            ? 'Seña de reserva'
            : p.tipo === 'reembolso'
              ? 'Reembolso de reserva'
              : 'Cobro de reserva';

        unificados.push({
          id: `rp-${p.id}`,
          categoria,
          fecha_hora: p.fecha_hora,
          monto: Number(p.monto),
          signo: p.tipo === 'reembolso' ? '-' : '+',
          descripcion,
          detalle: detalle || null,
          origen_id: p.id,
        });
      }

      // ── Ventas de buffet ────────────────────────────────────────────
      type VentaRow = {
        id: number;
        monto_total: number;
        fecha_hora: string;
        observaciones: string | null;
      };
      for (const v of (ventasRes.data ?? []) as VentaRow[]) {
        unificados.push({
          id: `v-${v.id}`,
          categoria: 'cobro_venta',
          fecha_hora: v.fecha_hora,
          monto: Number(v.monto_total),
          signo: '+',
          descripcion: `Venta buffet #${v.id}`,
          detalle: v.observaciones ?? null,
          origen_id: v.id,
        });
      }

      // ── Cobros de clases ────────────────────────────────────────────
      type ClaseCobroRow = {
        id: number;
        monto: number;
        fecha: string;
        fecha_hora: string;
        observaciones: string | null;
        clases: { nombre: string | null } | null;
      };
      for (const c of (clasesRes.data ?? []) as unknown as ClaseCobroRow[]) {
        const nombre = c.clases?.nombre?.trim();
        const fechaClase = fechaCortaFmt.format(
          new Date(c.fecha + 'T00:00:00'),
        );
        const detalle = nombre
          ? `${nombre} · ${fechaClase}`
          : `Clase del ${fechaClase}`;
        unificados.push({
          id: `cc-${c.id}`,
          categoria: 'cobro_clase',
          fecha_hora: c.fecha_hora,
          monto: Number(c.monto),
          signo: '+',
          descripcion: 'Cobro de clase',
          detalle,
          origen_id: c.id,
        });
      }

      // ── Manuales ────────────────────────────────────────────────────
      type ManualRow = {
        id: number;
        tipo: TipoMovimientoCaja;
        monto: number;
        concepto: string;
        observaciones: string | null;
        fecha_hora: string;
      };
      const MANUAL_LABEL: Record<TipoMovimientoCaja, string> = {
        retiro: 'Retiro de caja',
        pago_proveedor: 'Pago a proveedor',
        ajuste_positivo: 'Ajuste + (sobrante)',
        ajuste_negativo: 'Ajuste − (faltante)',
      };
      for (const m of (manualesRes.data ?? []) as ManualRow[]) {
        const categoria =
          (`manual_${m.tipo}` as CategoriaMovimientoCaja);
        unificados.push({
          id: `mm-${m.id}`,
          categoria,
          fecha_hora: m.fecha_hora,
          monto: Number(m.monto),
          signo: m.tipo === 'ajuste_positivo' ? '+' : '-',
          descripcion: MANUAL_LABEL[m.tipo],
          detalle:
            m.concepto +
            (m.observaciones ? ` — ${m.observaciones}` : ''),
          origen_id: m.id,
        });
      }

      // Ordenar cronológicamente DESC (más reciente primero).
      unificados.sort((a, b) => b.fecha_hora.localeCompare(a.fecha_hora));

      return unificados;
    },
  });
}
