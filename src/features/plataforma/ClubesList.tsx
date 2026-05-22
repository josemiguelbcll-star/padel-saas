import { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import { getLogoClubUrl } from '@/lib/clubBrand';
import { EstadoClubBadge } from './EstadoClubBadge';
import type { ClubResumen } from './hooks/useClubesPlataforma';

const fechaFmt = new Intl.DateTimeFormat('es-AR', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function fmtFecha(iso: string): string {
  return fechaFmt.format(new Date(iso));
}

interface ClubesListProps {
  clubes: ClubResumen[];
  /** Click en una fila → abre el dialog de gestión del club. */
  onClickClub: (club: ClubResumen) => void;
}

/**
 * Tabla de clubes del panel de plataforma. Cada fila es clickeable y
 * abre el `DetalleClubDialog` para gestionar plan y estado.
 *
 * Patrón consistente con las otras tablas del codebase
 * (UsuariosPage, ProductosPage): HTML simple + Tailwind, sin librería
 * de DataGrid.
 */
export function ClubesList({ clubes, onClickClub }: ClubesListProps) {
  if (clubes.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Todavía no hay clubes en la plataforma.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2 font-medium">Club</th>
            <th className="px-3 py-2 font-medium">Plan</th>
            <th className="px-3 py-2 font-medium">Estado</th>
            <th className="px-3 py-2 text-right font-medium">Usuarios</th>
            <th className="px-3 py-2 text-right font-medium">Canchas</th>
            <th className="px-3 py-2 font-medium">Alta</th>
          </tr>
        </thead>
        <tbody>
          {clubes.map((c) => (
            <tr
              key={c.id}
              onClick={() => onClickClub(c)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onClickClub(c);
                }
              }}
              tabIndex={0}
              role="button"
              aria-label={`Gestionar club ${c.nombre}`}
              className="cursor-pointer border-b border-border last:border-b-0 transition-colors hover:bg-muted/40 focus:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              <td className="px-3 py-3">
                <div className="flex items-center gap-2">
                  <ClubLogo path={c.logo_path} nombre={c.nombre} />
                  <span className="font-medium text-foreground">{c.nombre}</span>
                </div>
              </td>
              <td className="px-3 py-3 text-muted-foreground">
                {c.plan_nombre}
              </td>
              <td className="px-3 py-3">
                <EstadoClubBadge estado={c.estado} />
              </td>
              <td className="px-3 py-3 text-right tabular-nums text-foreground">
                {c.cantidad_usuarios}
              </td>
              <td className="px-3 py-3 text-right tabular-nums text-foreground">
                {c.cantidad_canchas}
              </td>
              <td className="px-3 py-3 text-muted-foreground tabular-nums">
                {fmtFecha(c.fecha_alta)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Logo del club a tamaño tabla (24px). Mismo onError fallback que el
 * topbar (mantiene UI prolija si el archivo fue borrado fuera del
 * flujo normal).
 */
function ClubLogo({ path, nombre }: { path: string | null; nombre: string }) {
  const url = getLogoClubUrl(path);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    setErrored(false);
  }, [path]);

  const muestraImg = !!url && !errored;

  if (!muestraImg) {
    return (
      <div
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground"
        aria-label={`Logo de ${nombre} no disponible`}
      >
        <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
      </div>
    );
  }

  return (
    <img
      key={path ?? ''}
      src={url ?? ''}
      alt={`Logo de ${nombre}`}
      onError={() => setErrored(true)}
      className="h-6 w-6 shrink-0 rounded bg-muted/50 object-contain"
    />
  );
}
