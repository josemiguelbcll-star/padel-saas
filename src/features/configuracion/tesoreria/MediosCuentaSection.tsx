import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import type { CuentaConSaldo, MedioPago } from '@/types/database';
import {
  useMediosCuentaDefault,
  useQuitarMedioCuentaDefault,
  useSetMedioCuentaDefault,
} from '@/features/configuracion/hooks/useMediosCuentaDefault';

const MEDIOS: ReadonlyArray<{ value: MedioPago; label: string }> = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'mp', label: 'Mercado Pago' },
  { value: 'tarjeta', label: 'Tarjeta' },
  { value: 'otro', label: 'Otro' },
];

interface MediosCuentaSectionProps {
  cuentas: CuentaConSaldo[];
  isAdmin: boolean;
}

/**
 * Asignación de la cuenta por defecto de cada uno de los 5 medios de pago.
 * "Sin asignar" = ese medio no tiene default → en Etapa 2 el operador elige
 * la cuenta al cobrar. Solo admin edita (la RLS lo refuerza server-side).
 */
export function MediosCuentaSection({ cuentas, isAdmin }: MediosCuentaSectionProps) {
  const query = useMediosCuentaDefault();
  const setMutation = useSetMedioCuentaDefault();
  const quitarMutation = useQuitarMedioCuentaDefault();
  const [error, setError] = useState<string | null>(null);

  const porMedio = useMemo(() => {
    const m = new Map<MedioPago, number>();
    for (const row of query.data ?? []) m.set(row.medio_pago, row.cuenta_id);
    return m;
  }, [query.data]);

  const pending = setMutation.isPending || quitarMutation.isPending;

  async function handleChange(medio: MedioPago, value: string): Promise<void> {
    setError(null);
    try {
      if (value === '') {
        await quitarMutation.mutateAsync(medio);
      } else {
        await setMutation.mutateAsync({ medio_pago: medio, cuenta_id: Number(value) });
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No pudimos guardar el cambio.',
      );
    }
  }

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-base font-semibold tracking-tight text-foreground">
          Cuenta por defecto de cada medio
        </h3>
        <p className="text-sm text-muted-foreground">
          Cuando se cobra o paga con un medio, la plata cae por defecto en esta
          cuenta. <strong>Sin asignar</strong> = el operador elegirá la cuenta
          al cobrar (se activa en la próxima etapa).
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {MEDIOS.map((medio) => {
          const cuentaId = porMedio.get(medio.value);
          return (
            <div
              key={medio.value}
              className="flex flex-wrap items-center justify-between gap-3 p-3"
            >
              <span className="text-sm font-medium text-foreground">
                {medio.label}
              </span>
              <select
                aria-label={`Cuenta por defecto de ${medio.label}`}
                value={cuentaId ?? ''}
                onChange={(e) => {
                  void handleChange(medio.value, e.target.value);
                }}
                disabled={!isAdmin || pending || query.isLoading}
                className={cn(
                  'h-9 min-w-[220px] rounded-md border border-input bg-background px-3 py-1 text-sm',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                <option value="">— Sin asignar (se elige al cobrar) —</option>
                {cuentas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                    {!c.activa ? ' (inactiva)' : ''}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </section>
  );
}
