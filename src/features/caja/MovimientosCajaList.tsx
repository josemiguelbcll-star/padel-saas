import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  CircleDollarSign,
  Coffee,
  GraduationCap,
  TrendingDown,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type {
  CategoriaMovimientoCaja,
  MovimientoCajaUnificado,
} from './hooks/useMovimientosCaja';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const horaFmt = new Intl.DateTimeFormat('es-AR', {
  hour: '2-digit',
  minute: '2-digit',
});

interface CategoriaConfig {
  Icon: LucideIcon;
  label: string;
}

const CATEGORIA_CONFIG: Record<CategoriaMovimientoCaja, CategoriaConfig> = {
  cobro_reserva_pago: { Icon: CalendarDays, label: 'Reserva' },
  cobro_reserva_sena: { Icon: CalendarDays, label: 'Reserva' },
  cobro_reserva_reembolso: { Icon: CalendarDays, label: 'Reserva' },
  cobro_venta: { Icon: Coffee, label: 'Buffet' },
  cobro_clase: { Icon: GraduationCap, label: 'Clase' },
  manual_retiro: { Icon: TrendingDown, label: 'Manual' },
  manual_pago_proveedor: { Icon: TrendingDown, label: 'Manual' },
  manual_ajuste_positivo: { Icon: CircleDollarSign, label: 'Manual' },
  manual_ajuste_negativo: { Icon: CircleDollarSign, label: 'Manual' },
};

/**
 * Lista cronológica (DESC) de TODOS los movimientos de la caja del
 * día: cobros individuales (reservas, ventas, clases) + movimientos
 * manuales (retiros, pagos a proveedor, ajustes).
 *
 * Pensado para auditar la jornada: si al cierre falta plata, esta
 * lista permite rastrear cuándo y por qué entró/salió cada peso.
 * Cada cobro de reserva muestra la fecha + hora + cancha del turno
 * para identificarlo rápido.
 *
 * Solo refleja EFECTIVO físico (los cobros por otros medios no
 * entran a la caja).
 */
export function MovimientosCajaList({
  movimientos,
}: {
  movimientos: MovimientoCajaUnificado[];
}) {
  if (movimientos.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Todavía no hay movimientos en esta caja.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2 font-medium">Hora</th>
            <th className="px-3 py-2 font-medium">Origen</th>
            <th className="px-3 py-2 font-medium">Detalle</th>
            <th className="px-3 py-2 text-right font-medium">Monto</th>
          </tr>
        </thead>
        <tbody>
          {movimientos.map((m) => {
            const cfg = CATEGORIA_CONFIG[m.categoria];
            const esEntrada = m.signo === '+';
            const color = esEntrada
              ? 'hsl(var(--estado-pagada))'
              : 'hsl(var(--destructive))';

            return (
              <tr
                key={m.id}
                className="border-b border-border last:border-b-0 hover:bg-muted/20"
              >
                <td className="px-3 py-2 align-top text-muted-foreground tabular-nums">
                  {horaFmt.format(new Date(m.fecha_hora))}
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="flex items-center gap-1.5">
                    <cfg.Icon
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="text-foreground">{cfg.label}</span>
                  </div>
                </td>
                <td className="px-3 py-2 align-top">
                  <p className="text-foreground">{m.descripcion}</p>
                  {m.detalle && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {m.detalle}
                    </p>
                  )}
                </td>
                <td
                  className="px-3 py-2 align-top text-right font-medium tabular-nums"
                  style={{ color }}
                >
                  <div className="flex items-center justify-end gap-1">
                    {esEntrada ? (
                      <ArrowUp
                        className="h-3 w-3"
                        aria-label="entrada"
                      />
                    ) : (
                      <ArrowDown
                        className="h-3 w-3"
                        aria-label="salida"
                      />
                    )}
                    {esEntrada ? '+' : '−'}
                    {currencyFmt.format(m.monto)}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
