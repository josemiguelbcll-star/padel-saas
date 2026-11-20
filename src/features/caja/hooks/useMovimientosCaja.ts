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
  /** Cuenta donde se acreditó el movimiento, si está configurada. */
  cuenta_id: number | null;
  cuenta_nombre: string | null;
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
 * Lista cronológica (DESC — más reciente primero) de todos los
 * movimientos asociados a la jornada de caja física + movimientos manuales.
 *
 * Hace 4 queries paralelas con embeds para traer info contextual
 * (reservas → cancha; clases → nombre). Si los embeds tiraran 400
 * en algún entorno, se podrían reemplazar por queries separadas.
 *
 * La RPC asocia a `turno_caja_id` los cobros de cuentas físicas según
 * `cuentas.es_caja_fisica`; filtrar por el literal del medio excluiría
 * cuentas físicas adicionales configuradas por el club.
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

      const [pagosRes, clasesRes, manualesRes] = await Promise.all([
        supabase
          .from('reserva_pagos')
          .select(
            `
            id, monto, tipo, fecha_hora, cuenta_id,
            reservas (fecha, hora_inicio, canchas (nombre))
            `,
          )
          .eq('turno_caja_id', turnoCajaId),
        supabase
          .from('clase_cobros')
          .select(
            `
            id, monto, fecha, fecha_hora, observaciones, cuenta_id,
            clases (nombre)
            `,
          )
          .eq('turno_caja_id', turnoCajaId),
        supabase
          .from('caja_movimientos_manuales')
          .select('id, tipo, monto, concepto, observaciones, fecha_hora')
          .eq('turno_caja_id', turnoCajaId),
      ]);

      for (const r of [pagosRes, clasesRes, manualesRes]) {
        if (r.error) throw new Error(mapPostgrestError(r.error));
      }

      const unificados: MovimientoCajaUnificado[] = [];

      // ── Cobros de reservas (con info de turno: fecha, hora, cancha) ─
      type PagoEmbed = {
        id: number;
        monto: number;
        tipo: 'sena' | 'pago' | 'reembolso';
        fecha_hora: string;
        cuenta_id: number | null;
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
          cuenta_id: p.cuenta_id,
          cuenta_nombre: null,
          origen_id: p.id,
        });
      }

      // ── Ventas de buffet (efectivo desde venta_pagos con fallback) ──
      type VentaPagoRow = {
        id: number;
        venta_id: number;
        monto: number;
        cuenta_id: number | null;
        fecha_hora: string;
        ventas: { observaciones: string | null } | null;
      };
      type VentaRow = {
        id: number;
        monto_total: number;
        cuenta_id: number | null;
        fecha_hora: string;
        observaciones: string | null;
      };

      const vpRes = await supabase
        .from('venta_pagos')
        .select('id, venta_id, monto, cuenta_id, fecha_hora, ventas(observaciones)')
        .eq('turno_caja_id', turnoCajaId);
      let ventasCaja: Array<{
        id: number;
        ventaId: number;
        monto: number;
        cuentaId: number | null;
        fechaHora: string;
        observaciones: string | null;
      }> = [];

      if (!vpRes.error && vpRes.data) {
        ventasCaja = (vpRes.data as unknown as VentaPagoRow[]).map((pago) => ({
          id: pago.id,
          ventaId: pago.venta_id,
          monto: Number(pago.monto),
          cuentaId: pago.cuenta_id,
          fechaHora: pago.fecha_hora,
          observaciones: pago.ventas?.observaciones ?? null,
        }));
      } else {
        const vRes = await supabase
          .from('ventas')
          .select('id, monto_total, cuenta_id, fecha_hora, observaciones')
          .eq('turno_caja_id', turnoCajaId);
        if (vRes.error) throw new Error(mapPostgrestError(vRes.error));
        ventasCaja = ((vRes.data ?? []) as VentaRow[]).map((venta) => ({
          id: venta.id,
          ventaId: venta.id,
          monto: Number(venta.monto_total),
          cuentaId: venta.cuenta_id,
          fechaHora: venta.fecha_hora,
          observaciones: venta.observaciones,
        }));
      }

      for (const pago of ventasCaja) {
        const observacionLimpia = pago.observaciones
          ?.replace(/\[Desglose:\s*[\s\S]*?\]/gi, '')
          .trim();
        unificados.push({
          id: `vp-${pago.id}`,
          categoria: 'cobro_venta',
          fecha_hora: pago.fechaHora,
          monto: pago.monto,
          signo: '+',
          descripcion: `Venta buffet #${pago.ventaId}`,
          detalle: observacionLimpia || null,
          cuenta_id: pago.cuentaId,
          cuenta_nombre: null,
          origen_id: pago.ventaId,
        });
      }

      // ── Cobros de clases ────────────────────────────────────────────
      type ClaseCobroRow = {
        id: number;
        monto: number;
        fecha: string;
        fecha_hora: string;
        observaciones: string | null;
        cuenta_id: number | null;
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
          cuenta_id: c.cuenta_id,
          cuenta_nombre: null,
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
          cuenta_id: null,
          cuenta_nombre: null,
          origen_id: m.id,
        });
      }

      const cuentaIds = [...new Set(unificados.map((m) => m.cuenta_id).filter((id): id is number => id !== null))];
      if (cuentaIds.length > 0) {
        const { data: cuentas, error: cuentasErr } = await supabase
          .from('cuentas')
          .select('id, nombre')
          .in('id', cuentaIds);
        if (cuentasErr) throw new Error(mapPostgrestError(cuentasErr));
        const nombresPorId = new Map((cuentas ?? []).map((cuenta) => [cuenta.id, cuenta.nombre]));
        for (const movimiento of unificados) {
          if (movimiento.cuenta_id !== null) {
            movimiento.cuenta_nombre = nombresPorId.get(movimiento.cuenta_id) ?? null;
          }
        }
      }

      // Ordenar cronológicamente DESC (más reciente primero).
      unificados.sort((a, b) => b.fecha_hora.localeCompare(a.fecha_hora));

      return unificados;
    },
  });
}
