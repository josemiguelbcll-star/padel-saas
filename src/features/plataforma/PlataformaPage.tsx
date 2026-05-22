import { useState } from 'react';
import { Loader2, LogOut, Plus, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSession } from '@/features/auth/useSession';
import { ClubesList } from './ClubesList';
import { DetalleClubDialog } from './DetalleClubDialog';
import { NuevoClubDialog } from './NuevoClubDialog';
import { useClubesPlataforma } from './hooks/useClubesPlataforma';

/**
 * Pantalla principal del panel de plataforma (etapa 2).
 *
 * Header: badge "Panel de plataforma" + nombre/email del superadmin +
 * botón cerrar sesión.
 * Body: lista de TODOS los clubes (vía RPC `clubes_resumen_plataforma`).
 *
 * Reemplaza a `PlataformaWelcome` (etapa 1). Sin sidebar todavía —
 * cuando agreguemos más secciones del panel (planes, estados,
 * métricas) refactorizamos a un layout con navegación lateral.
 */
export function PlataformaPage() {
  const { plataformaAdmin, signOut } = useSession();
  const clubesQuery = useClubesPlataforma();

  // El dialog vive en la página y se abre con el clubId del click.
  // El dialog mismo resuelve el club desde el cache via clubId, así
  // refleja cambios inmediatos después de cada mutation.
  const [selectedClubId, setSelectedClubId] = useState<number | null>(null);
  const [nuevoClubOpen, setNuevoClubOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      {/* Header sticky con identidad del superadmin + signOut */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-6">
          <div className="flex items-center gap-2 text-primary">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-wide">
              Panel de plataforma
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-foreground">
                {plataformaAdmin?.nombre ?? '—'}
              </p>
              {plataformaAdmin?.email && (
                <p className="text-[11px] text-muted-foreground">
                  {plataformaAdmin.email}
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void signOut();
              }}
            >
              <LogOut className="h-3.5 w-3.5" />
              Salir
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 px-4 py-6 md:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold text-foreground">
              Clubes
              {clubesQuery.data && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({clubesQuery.data.length})
                </span>
              )}
            </h1>
            <p className="text-sm text-muted-foreground">
              Todos los clubes registrados en la plataforma. Ordenados
              alfabéticamente.
            </p>
          </div>
          <Button
            type="button"
            onClick={() => setNuevoClubOpen(true)}
            className="shrink-0"
          >
            <Plus className="h-4 w-4" />
            Nuevo club
          </Button>
        </div>

        {clubesQuery.isLoading && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Cargando clubes…
          </div>
        )}

        {clubesQuery.error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {clubesQuery.error.message}
          </div>
        )}

        {clubesQuery.data && (
          <ClubesList
            clubes={clubesQuery.data}
            onClickClub={(club) => setSelectedClubId(club.id)}
          />
        )}
      </main>

      <DetalleClubDialog
        open={selectedClubId !== null}
        onOpenChange={(next) => {
          if (!next) setSelectedClubId(null);
        }}
        clubId={selectedClubId}
      />

      <NuevoClubDialog
        open={nuevoClubOpen}
        onOpenChange={setNuevoClubOpen}
      />
    </div>
  );
}
