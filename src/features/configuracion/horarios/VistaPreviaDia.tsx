import { formatearHora } from '@/features/reservas/utils/horaUtils';
import { agruparInicios, type InicioPreview } from './previewFranjas';

/** "60' o 90'" / "90'" — etiqueta compacta del set de duraciones. */
function duracionesLabel(durs: number[]): string {
  return `${durs.join("' o ")}'`;
}

/**
 * Tira de vista previa: muestra los inicios que ofrecería la grilla un
 * día dado, agrupando inicios consecutivos con el mismo set de
 * duraciones. Presentacional: recibe los inicios ya calculados.
 */
export function VistaPreviaDia({ inicios }: { inicios: InicioPreview[] }) {
  if (inicios.length === 0) {
    return (
      <p className="text-xs italic text-muted-foreground">
        No hay inicios para mostrar. Revisá la apertura/cierre y las franjas.
      </p>
    );
  }

  const grupos = agruparInicios(inicios);

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-xs">
      {grupos.map((g) => (
        <span
          key={`${g.horas[0]}-${g.duraciones.join('-')}`}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1"
        >
          <span className="font-medium tabular-nums text-foreground">
            {g.horas.map((h) => formatearHora(h)).join(' · ')}
          </span>
          <span className="text-muted-foreground">
            ({duracionesLabel(g.duraciones)})
          </span>
        </span>
      ))}
    </div>
  );
}
