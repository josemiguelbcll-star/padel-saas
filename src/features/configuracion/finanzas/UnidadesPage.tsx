import { useMemo, useState } from 'react';
import { CircleDot, Loader2, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSession } from '@/features/auth';
import { useCategoriasGasto } from '@/features/finanzas/hooks/useCategoriasGasto';
import { useUnidadesNegocio } from '@/features/finanzas/hooks/useUnidadesNegocio';
import { TIPO_UNIDAD_LABEL } from '@/features/finanzas/finanzasSchemas';
import type { TipoUnidad, UnidadNegocio } from '@/types/database';
import { UnidadFormDialog } from './UnidadFormDialog';

/**
 * Color por tipo de unidad para distinguir visualmente.
 *   - canchas/clases (operativas con servicio):     azul (primary)
 *   - buffet/shop (operativas con stock):           verde
 *   - estructura:                                   ámbar
 *   - auspicios/membresias/otro (manuales):         gris
 */
const TIPO_COLOR: Record<TipoUnidad, { fg: string; bg: string }> = {
  canchas: { fg: 'hsl(var(--primary))', bg: 'hsl(var(--primary) / 0.10)' },
  clases: { fg: 'hsl(var(--primary))', bg: 'hsl(var(--primary) / 0.10)' },
  buffet: { fg: 'hsl(var(--estado-pagada))', bg: 'hsl(var(--estado-pagada) / 0.10)' },
  shop: { fg: 'hsl(var(--estado-pagada))', bg: 'hsl(var(--estado-pagada) / 0.10)' },
  estructura: { fg: 'hsl(var(--estado-senada))', bg: 'hsl(var(--estado-senada) / 0.10)' },
  financiero: { fg: 'hsl(var(--estado-senada))', bg: 'hsl(var(--estado-senada) / 0.10)' },
  auspicios: { fg: 'hsl(var(--muted-foreground))', bg: 'hsl(var(--muted) / 0.5)' },
  membresias: { fg: 'hsl(var(--muted-foreground))', bg: 'hsl(var(--muted) / 0.5)' },
  otro: { fg: 'hsl(var(--muted-foreground))', bg: 'hsl(var(--muted) / 0.5)' },
};

export function UnidadesPage() {
  const { user } = useSession();
  const isAdmin = user?.rol === 'admin';

  const unidadesQuery = useUnidadesNegocio();
  const catQuery = useCategoriasGasto();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UnidadNegocio | null>(null);

  // Contador de categorías por unidad — útil para que el admin vea de
  // un vistazo dónde concentra clasificaciones.
  const contadorCategorias = useMemo(() => {
    const cats = catQuery.data ?? [];
    const map = new Map<number, number>();
    for (const c of cats) {
      map.set(c.unidad_id, (map.get(c.unidad_id) ?? 0) + 1);
    }
    return map;
  }, [catQuery.data]);

  function openNew(): void {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(u: UnidadNegocio): void {
    setEditing(u);
    setFormOpen(true);
  }

  return (
    <section className="space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Unidades de negocio
          </h2>
          <p className="text-sm text-muted-foreground">
            Agrupan los ingresos y gastos del club para el estado de
            resultados. Los tipos <strong>canchas, clases, buffet</strong>{' '}
            y <strong>shop</strong> reciben ingresos automáticos desde
            las pantallas operativas; el resto se carga manualmente.
          </p>
        </div>
        {isAdmin && (
          <Button type="button" onClick={openNew} className="shrink-0">
            <Plus className="h-4 w-4" />
            Nueva unidad
          </Button>
        )}
      </header>

      {unidadesQuery.isLoading && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Cargando…
        </div>
      )}

      {unidadesQuery.error && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {unidadesQuery.error.message}
        </div>
      )}

      {unidadesQuery.data && unidadesQuery.data.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Todavía no hay unidades cargadas. Pedile al admin que ejecute
            la inicialización financiera o agregalas manualmente.
          </p>
        </div>
      )}

      {unidadesQuery.data && unidadesQuery.data.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {unidadesQuery.data.map((u) => {
            const colores = TIPO_COLOR[u.tipo];
            const cantCat = contadorCategorias.get(u.id) ?? 0;
            return (
              <article
                key={u.id}
                className={cn(
                  'group rounded-lg border border-border bg-card p-4 transition-colors',
                  !u.activa && 'opacity-60',
                  isAdmin && 'hover:border-primary/50',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider">
                    <span
                      className="inline-flex h-5 items-center rounded px-1.5"
                      style={{ backgroundColor: colores.bg, color: colores.fg }}
                    >
                      {TIPO_UNIDAD_LABEL[u.tipo]}
                    </span>
                    {!u.activa && (
                      <span className="inline-flex h-5 items-center rounded bg-muted px-1.5 text-muted-foreground">
                        Inactiva
                      </span>
                    )}
                  </div>
                  {isAdmin && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => openEdit(u)}
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label={`Editar ${u.nombre}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                <h3 className="mt-2 text-base font-semibold text-foreground">
                  {u.nombre}
                </h3>
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <CircleDot className="h-3 w-3" aria-hidden="true" />
                  {cantCat === 0
                    ? 'Sin categorías de gasto'
                    : `${cantCat} ${cantCat === 1 ? 'categoría' : 'categorías'} de gasto`}
                </p>
              </article>
            );
          })}
        </div>
      )}

      <UnidadFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initialValue={editing}
      />
    </section>
  );
}
