import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateTarifa } from '@/features/configuracion/hooks/useTarifas';

/**
 * Atajo "Cobro lo mismo siempre" del paso 3 del wizard.
 *
 * Crea UNA tarifa con franja/días null y prioridad 0 — es decir, una
 * "tarifa única" que aplica a todo. El nombre se fija en "Tarifa estándar"
 * para no obligar al usuario a inventar uno en este paso simple. Si quiere
 * renombrarla, puede hacerlo después desde la pantalla de Tarifas.
 *
 * Cuando se crea con éxito, el padre (StepTarifas) detecta que ya hay
 * tarifas en la DB y reemplaza el atajo por TarifasPage completo.
 */
const atajoSchema = z.object({
  monto: z.coerce
    .number({ invalid_type_error: 'Ingresá un monto válido.' })
    .min(0, 'El monto debe ser mayor o igual a 0.'),
});

export function AtajoCobroFijo() {
  const createMutation = useCreateTarifa();
  const [monto, setMonto] = useState('');
  const [montoError, setMontoError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setMontoError(null);
    setFormError(null);

    const parsed = atajoSchema.safeParse({ monto });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setMontoError(issue?.message ?? 'Monto inválido.');
      return;
    }

    try {
      await createMutation.mutateAsync({
        nombre: 'Tarifa estándar',
        monto: parsed.data.monto,
        desde_hora: null,
        hasta_hora: null,
        dias_semana: null,
        prioridad: 0,
        activa: true,
      });
      // La invalidación de useTarifas en el hook va a hacer que el padre
      // (StepTarifas) re-evalúe `tarifas.length === 0` y desmonte este
      // componente automáticamente. No hace falta callback acá.
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : 'No pudimos crear la tarifa. Probá de nuevo.',
      );
    }
  }

  const isPending = createMutation.isPending;

  return (
    <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">
          ¿Cobrás lo mismo siempre?
        </h3>
        <p className="text-sm text-muted-foreground">
          Definí un precio único. Va a aplicar a todos los horarios y días.
          Después podés agregar tarifas más específicas si las necesitás.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 space-y-3" noValidate>
        <div className="space-y-2">
          <Label htmlFor="atajo-monto">Monto (pesos)</Label>
          <Input
            id="atajo-monto"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            disabled={isPending}
            placeholder="0.00"
            aria-invalid={montoError ? true : undefined}
            autoFocus
          />
          {montoError && (
            <p className="text-xs text-destructive">{montoError}</p>
          )}
        </div>

        {formError && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {formError}
          </div>
        )}

        <Button type="submit" disabled={isPending}>
          {isPending ? 'Creando…' : 'Crear tarifa única'}
        </Button>
      </form>
    </div>
  );
}
