import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { TarifasPage } from '@/features/configuracion';
import { useTarifas } from '@/features/configuracion/hooks/useTarifas';
import { AtajoCobroFijo } from './AtajoCobroFijo';

/**
 * Paso 3 del wizard. Por defecto muestra el atajo "Cobro lo mismo siempre"
 * mientras el club no tenga ninguna tarifa cargada. Apenas existe al
 * menos una tarifa (creada vía atajo o vía botón "configuración avanzada"),
 * la UI transiciona automáticamente a TarifasPage completa, donde el admin
 * puede agregar más tarifas con franja/días/prioridad si las necesita.
 */
export function StepTarifas() {
  const tarifasQuery = useTarifas();
  const [forceAvanzado, setForceAvanzado] = useState(false);

  if (tarifasQuery.isLoading) {
    return (
      <div className="h-32 animate-pulse rounded-md border border-border bg-muted/40" />
    );
  }

  const tarifas = tarifasQuery.data ?? [];
  const showAtajo = !forceAvanzado && tarifas.length === 0;

  if (showAtajo) {
    return (
      <div className="space-y-3">
        <AtajoCobroFijo />
        <div className="text-center">
          <Button
            type="button"
            variant="link"
            onClick={() => setForceAvanzado(true)}
            className="text-sm text-muted-foreground"
          >
            Necesito tarifas más complejas →
          </Button>
        </div>
      </div>
    );
  }

  return <TarifasPage />;
}
