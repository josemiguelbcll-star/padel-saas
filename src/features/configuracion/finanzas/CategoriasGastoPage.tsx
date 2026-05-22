import { useMemo, useState } from 'react';
import { Loader2, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSession } from '@/features/auth';
import { useCategoriasGasto } from '@/features/finanzas/hooks/useCategoriasGasto';
import { useUnidadesNegocio } from '@/features/finanzas/hooks/useUnidadesNegocio';
import { TIPO_UNIDAD_LABEL } from '@/features/finanzas/finanzasSchemas';
import type { CategoriaGasto, UnidadNegocio } from '@/types/database';
import { CategoriaGastoFormDialog } from './CategoriaGastoFormDialog';

interface CategoriasAgrupadasItem {
  unidad: UnidadNegocio;
  categorias: CategoriaGasto[];
}

export function CategoriasGastoPage() {
  const { user } = useSession();
  const isAdmin = user?.rol === 'admin';

  const unidadesQuery = useUnidadesNegocio();
  const catQuery = useCategoriasGasto();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CategoriaGasto | null>(null);

  function openNew(): void {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(c: CategoriaGasto): void {
    setEditing(c);
    setFormOpen(true);
  }

  // Agrupar categorías por unidad (incluyendo unidades inactivas para
  // que el admin vea las que arrastraron categorías de cuando estaban
  // activas).
  const agrupadas: CategoriasAgrupadasItem[] = useMemo(() => {
    const unidades = unidadesQuery.data ?? [];
    const cats = catQuery.data ?? [];
    return unidades.map((u) => ({
      unidad: u,
      categorias: cats.filter((c) => c.unidad_id === u.id),
    }));
  }, [unidadesQuery.data, catQuery.data]);

  const isLoading = unidadesQuery.isLoading || catQuery.isLoading;
  const error = unidadesQuery.error ?? catQuery.error;

  return (
    <section className="space-y-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Categorías de gasto
          </h2>
          <p className="text-sm text-muted-foreground">
            Clasifican los gastos dentro de cada unidad. Necesarias para
            cargar gastos — sin categoría, el form no permite registrar.
          </p>
        </div>
        {isAdmin && (
          <Button type="button" onClick={openNew} className="shrink-0">
            <Plus className="h-4 w-4" />
            Nueva categoría
          </Button>
        )}
      </header>

      {isLoading && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Cargando…
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error.message}
        </div>
      )}

      {!isLoading && !error && agrupadas.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Cargá primero las unidades de negocio para poder organizar
            las categorías.
          </p>
        </div>
      )}

      {!isLoading &&
        !error &&
        agrupadas.map(({ unidad, categorias }) => (
          <article
            key={unidad.id}
            className={cn(
              'space-y-2 rounded-lg border border-border bg-card p-4',
              !unidad.activa && 'opacity-60',
            )}
          >
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {unidad.nombre}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  · {TIPO_UNIDAD_LABEL[unidad.tipo]}
                  {!unidad.activa && ' · inactiva'}
                </span>
              </h3>
              <span className="text-xs text-muted-foreground">
                {categorias.length} categoría{categorias.length === 1 ? '' : 's'}
              </span>
            </div>

            {categorias.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Sin categorías en esta unidad.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {categorias.map((c) => (
                  <li
                    key={c.id}
                    className={cn(
                      'flex items-center justify-between gap-3 px-3 py-2',
                      !c.activa && 'opacity-60',
                    )}
                  >
                    <div className="flex-1 text-sm text-foreground">
                      {c.nombre}
                      {!c.activa && (
                        <span className="ml-2 inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          Inactiva
                        </span>
                      )}
                    </div>
                    {isAdmin && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(c)}
                        aria-label={`Editar ${c.nombre}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}

      <CategoriaGastoFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initialValue={editing}
      />
    </section>
  );
}
