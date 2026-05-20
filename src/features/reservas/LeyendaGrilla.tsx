/**
 * Leyenda chica que aparece debajo de la grilla del día. Comunica el
 * significado visual de cada tipo de bloque y de la línea roja.
 *
 * Los swatches usan los mismos tokens (CSS variables) que los bloques
 * reales: cualquier cambio de paleta en globals.css se propaga acá sin
 * tocar este archivo.
 */
export function LeyendaGrilla() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
      <Item label="Pagada" colorVar="--estado-pagada" />
      <Item label="Señada" colorVar="--estado-senada" />
      <Item label="Pendiente" colorVar="--estado-pendiente" />
      <Item label="Jugada" colorVar="--estado-jugada" />
      <Item label="Clase" colorVar="--clase" />
      <DashedItem label="Disponible" />
      <AhoraItem label="Ahora" />
    </div>
  );
}

function Item({ label, colorVar }: { label: string; colorVar: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="inline-block h-3 w-3 rounded-sm"
        style={{ backgroundColor: `hsl(var(${colorVar}))` }}
      />
      <span>{label}</span>
    </div>
  );
}

function DashedItem({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="inline-block h-3 w-3 rounded-sm border border-dashed border-border"
      />
      <span>{label}</span>
    </div>
  );
}

function AhoraItem({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span aria-hidden="true" className="relative inline-block w-4">
        <span className="block h-[2px] w-full bg-destructive" />
        <span className="absolute left-0 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-destructive" />
      </span>
      <span>{label}</span>
    </div>
  );
}
