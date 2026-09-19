import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, ExternalLink, Loader2, Smartphone, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSession } from '@/features/auth/useSession';
import { getLogoClubUrl } from '@/lib/clubBrand';
import { EstadoClubBadge } from './EstadoClubBadge';
import type { ClubResumen } from './hooks/useClubesPlataforma';


const dineroFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function fmtDinero(monto: number): string {
  return dineroFmt.format(monto);
}

interface ClubesListProps {
  clubes: ClubResumen[];
  /** Click en una fila → abre el dialog de gestión del club. */
  onClickClub: (club: ClubResumen) => void;
}

/**
 * Tabla de clubes del panel de plataforma enriquecida con:
 * - Métricas de reservas (Total vs App MatchGo vs Recepción)
 * - Botón de acceso directo / impersonación ("Ingresar al Club")
 * - Detalle y configuración de estados
 */
export function ClubesList({ clubes, onClickClub }: ClubesListProps) {
  const { impersonateClub } = useSession();
  const navigate = useNavigate();
  const [enteringClubId, setEnteringClubId] = useState<number | null>(null);

  if (clubes.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center bg-card">
        <p className="text-sm text-muted-foreground">
          No se encontraron clubes que coincidan con los filtros aplicados.
        </p>
      </div>
    );
  }

  const handleIngresarClub = async (e: React.MouseEvent, clubId: number) => {
    e.stopPropagation();
    setEnteringClubId(clubId);
    try {
      await impersonateClub(clubId);
      navigate('/app');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al ingresar al club.');
      setEnteringClubId(null);
    }
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-3 font-semibold">Club</th>
            <th className="px-3 py-3 font-semibold">Admin / Contacto</th>
            <th className="px-3 py-3 font-semibold">Estado / Plan</th>
            <th className="px-3 py-3 font-semibold text-right">Reservas (App vs Rec.)</th>
            <th className="px-3 py-3 font-semibold text-right">Canchas / Jugadores</th>
            <th className="px-3 py-3 font-semibold text-right">Ventas (Mes)</th>
            <th className="px-3 py-3 font-semibold text-center">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {clubes.map((c) => {
            const totReservas = c.total_reservas ?? 0;
            const appReservas = c.reservas_app ?? 0;
            const recReservas = c.reservas_presenciales ?? (totReservas - appReservas);
            const pctApp = totReservas > 0 ? Math.round((appReservas / totReservas) * 100) : 0;
            const isEntering = enteringClubId === c.id;

            return (
              <tr
                key={c.id}
                onClick={() => onClickClub(c)}
                tabIndex={0}
                role="button"
                aria-label={`Gestionar club ${c.nombre}`}
                className="cursor-pointer transition-colors hover:bg-muted/40 focus:bg-muted/40 focus:outline-none"
              >
                {/* Nombre y slug */}
                <td className="px-3 py-3.5">
                  <div className="flex items-center gap-3">
                    <ClubLogo path={c.logo_path} nombre={c.nombre} />
                    <div className="flex flex-col min-w-0">
                      <span className="font-semibold text-foreground text-sm truncate">
                        {c.nombre}
                      </span>
                      <span className="text-[11px] text-muted-foreground font-mono">
                        {c.slug ? `/${c.slug}` : '—'}
                      </span>
                    </div>
                  </div>
                </td>

                {/* Admin */}
                <td className="px-3 py-3.5">
                  {c.admin_email ? (
                    <div className="flex flex-col min-w-0 max-w-[180px]">
                      <span className="truncate text-xs font-medium text-foreground">
                        {c.admin_nombre || 'Administrador'}
                      </span>
                      <span className="truncate text-[11px] text-muted-foreground font-mono" title={c.admin_email}>
                        {c.admin_email}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground italic">Sin admin</span>
                  )}
                </td>

                {/* Estado & Plan */}
                <td className="px-3 py-3.5">
                  <div className="flex flex-col gap-1 items-start">
                    <EstadoClubBadge estado={c.estado} />
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                      Plan {c.plan_nombre}
                    </span>
                  </div>
                </td>

                {/* Reservas (App vs Recepción) */}
                <td className="px-3 py-3.5 text-right">
                  <div className="flex flex-col items-end gap-0.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <span>{totReservas.toLocaleString('es-AR')} total</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                        <Smartphone className="h-3 w-3" />
                        {appReservas} app ({pctApp}%)
                      </span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground">{recReservas} rec.</span>
                    </div>
                  </div>
                </td>

                {/* Canchas y Jugadores */}
                <td className="px-3 py-3.5 text-right">
                  <div className="flex flex-col items-end text-xs">
                    <span className="font-medium text-foreground">
                      {c.cantidad_canchas} {c.cantidad_canchas === 1 ? 'cancha' : 'canchas'}
                    </span>
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {c.total_jugadores ?? '—'} jugadores
                    </span>
                  </div>
                </td>

                {/* Ventas */}
                <td className="px-3 py-3.5 text-right">
                  <div className="flex flex-col items-end">
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400 text-xs">
                      {fmtDinero(c.total_ventas_mes_actual ?? 0)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      Total: {fmtDinero(c.total_ventas_historico ?? 0)}
                    </span>
                  </div>
                </td>

                {/* Acciones */}
                <td className="px-3 py-3.5 text-center" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-center gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 px-2.5 text-xs font-medium gap-1 bg-primary text-primary-foreground hover:bg-primary/90 shadow-none"
                      disabled={isEntering}
                      onClick={(e) => handleIngresarClub(e, c.id)}
                      title={`Ingresar como administrador a ${c.nombre}`}
                    >
                      {isEntering ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ExternalLink className="h-3.5 w-3.5" />
                      )}
                      Ingresar
                    </Button>
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

/**
 * Logo del club a tamaño tabla (28px)
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
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground"
        aria-label={`Logo de ${nombre} no disponible`}
      >
        <Building2 className="h-4 w-4" aria-hidden="true" />
      </div>
    );
  }

  return (
    <img
      key={path ?? ''}
      src={url ?? ''}
      alt={`Logo de ${nombre}`}
      onError={() => setErrored(true)}
      className="h-7 w-7 shrink-0 rounded bg-muted/50 object-contain"
    />
  );
}
