import { useEffect, useMemo, useState } from 'react';
import {
  Mail,
  Pencil,
  Phone,
  Plus,
  Power,
  PowerOff,
  Search,
  Truck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useSession } from '@/features/auth';
import {
  useProveedores,
  useUpdateProveedor,
} from '@/features/configuracion/hooks/useProveedores';
import type { Proveedor } from '@/types/database';
import { ProveedorFormDialog } from './ProveedorFormDialog';

export function ProveedoresPage() {
  const { user } = useSession();
  const isAdmin = user?.rol === 'admin';

  const proveedoresQuery = useProveedores();
  const updateMutation = useUpdateProveedor();

  const [busqueda, setBusqueda] = useState('');
  const [mostrarInactivos, setMostrarInactivos] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Proveedor | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  // Debounce de la búsqueda — la lista filtra in-memory, no necesita
  // ráfaga de re-renders en cada keystroke. 200 ms se siente inmediato.
  const busquedaDebounced = useDebouncedValue(busqueda, 200);

  const todos = proveedoresQuery.data ?? [];

  const visibles = useMemo(() => {
    const busq = busquedaDebounced.trim().toLowerCase();
    return todos.filter((p) => {
      if (!mostrarInactivos && !p.activo) return false;
      if (busq && !p.nombre.toLowerCase().includes(busq)) return false;
      return true;
    });
  }, [todos, busquedaDebounced, mostrarInactivos]);

  const conteoInactivos = useMemo(
    () => todos.filter((p) => !p.activo).length,
    [todos],
  );

  function openNew(): void {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(p: Proveedor): void {
    setEditing(p);
    setFormOpen(true);
  }

  async function toggleActivo(p: Proveedor): Promise<void> {
    setToggleError(null);
    try {
      await updateMutation.mutateAsync({
        id: p.id,
        changes: { activo: !p.activo },
      });
    } catch (err) {
      setToggleError(
        err instanceof Error
          ? err.message
          : 'No pudimos cambiar el estado. Probá de nuevo.',
      );
    }
  }

  return (
    <section className="space-y-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Proveedores
          </h2>
          <p className="text-sm text-muted-foreground">
            Catálogo de proveedores del club. Solo el nombre es obligatorio
            — cargá lo que tengas (CUIT, contacto, condiciones de pago) y
            completá después. Los datos van a usarse cuando aparezca el
            módulo de compras.
          </p>
        </div>
        {isAdmin && (
          <Button type="button" onClick={openNew} className="shrink-0">
            <Plus className="h-4 w-4" />
            Nuevo proveedor
          </Button>
        )}
      </header>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
        <div className="min-w-[220px] flex-1 space-y-1">
          <Label
            htmlFor="prov-buscar"
            className="text-[10px] uppercase tracking-wider text-muted-foreground"
          >
            Buscar
          </Label>
          <div className="relative">
            <Search
              className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="prov-buscar"
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Nombre del proveedor…"
              className="pl-8"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 pb-1">
          <button
            type="button"
            onClick={() => setMostrarInactivos((v) => !v)}
            aria-pressed={mostrarInactivos}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              mostrarInactivos
                ? 'border-primary/50 bg-primary/10 text-primary'
                : 'border-border bg-background text-muted-foreground hover:bg-muted',
            )}
          >
            Mostrar inactivos
            {conteoInactivos > 0 && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                {conteoInactivos}
              </span>
            )}
          </button>
        </div>
      </div>

      {toggleError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {toggleError}
        </div>
      )}

      <ProveedoresTable
        query={proveedoresQuery}
        proveedores={visibles}
        totalSinFiltros={todos.length}
        isAdmin={isAdmin}
        toggling={updateMutation.isPending}
        onEdit={openEdit}
        onToggle={(p) => {
          void toggleActivo(p);
        }}
      />

      <ProveedorFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initialValue={editing}
      />
    </section>
  );
}

interface ProveedoresTableProps {
  query: ReturnType<typeof useProveedores>;
  proveedores: Proveedor[];
  totalSinFiltros: number;
  isAdmin: boolean;
  toggling: boolean;
  onEdit: (p: Proveedor) => void;
  onToggle: (p: Proveedor) => void;
}

function ProveedoresTable({
  query,
  proveedores,
  totalSinFiltros,
  isAdmin,
  toggling,
  onEdit,
  onToggle,
}: ProveedoresTableProps) {
  if (query.isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-12 animate-pulse rounded-md border border-border bg-muted/40"
          />
        ))}
      </div>
    );
  }

  if (query.error) {
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
      >
        {query.error.message}
      </div>
    );
  }

  if (proveedores.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center">
        <Truck className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <p className="mt-2 text-sm text-muted-foreground">
          {totalSinFiltros === 0
            ? isAdmin
              ? 'Todavía no agregaste proveedores. Cargá el primero con "Nuevo proveedor" — solo el nombre es obligatorio.'
              : 'El administrador todavía no agregó proveedores.'
            : 'Ningún proveedor cumple los filtros actuales.'}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="border-b border-border bg-muted/30 px-4 py-2">
        <p className="text-xs text-muted-foreground">
          Mostrando{' '}
          <strong className="font-semibold text-foreground tabular-nums">
            {proveedores.length}
          </strong>{' '}
          de{' '}
          <strong className="font-semibold text-foreground tabular-nums">
            {totalSinFiltros}
          </strong>{' '}
          proveedor{totalSinFiltros === 1 ? '' : 'es'}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/20 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2 font-semibold">Nombre</th>
              <th className="px-3 py-2 font-semibold">Qué provee</th>
              <th className="px-3 py-2 font-semibold">Contacto</th>
              <th className="px-3 py-2 font-semibold">Condiciones de pago</th>
              <th className="px-3 py-2 font-semibold">Estado</th>
              {isAdmin && (
                <th className="w-1 px-4 py-2 text-right">
                  <span className="sr-only">Acciones</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {proveedores.map((p) => (
              <ProveedorRow
                key={p.id}
                p={p}
                isAdmin={isAdmin}
                toggling={toggling}
                onEdit={() => onEdit(p)}
                onToggle={() => onToggle(p)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface ProveedorRowProps {
  p: Proveedor;
  isAdmin: boolean;
  toggling: boolean;
  onEdit: () => void;
  onToggle: () => void;
}

function ProveedorRow({ p, isAdmin, toggling, onEdit, onToggle }: ProveedorRowProps) {
  return (
    <tr
      className={cn(
        'border-b border-border/50 last:border-b-0 transition-colors hover:bg-muted/20',
        !p.activo && 'bg-muted/20',
      )}
    >
      <td className="px-4 py-3 align-top">
        <p
          className={cn(
            'font-medium',
            p.activo ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {p.nombre}
        </p>
        {p.cuit && (
          <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
            CUIT {p.cuit}
          </p>
        )}
      </td>
      <td className="max-w-[200px] truncate px-3 py-3 align-top text-xs text-muted-foreground">
        {p.que_provee ?? <span className="text-muted-foreground/60">—</span>}
      </td>
      <td className="px-3 py-3 align-top text-xs text-muted-foreground">
        {p.contacto_persona || p.contacto_telefono || p.contacto_email ? (
          <div className="space-y-0.5">
            {p.contacto_persona && (
              <p className="text-foreground">{p.contacto_persona}</p>
            )}
            {p.contacto_telefono && (
              <p className="flex items-center gap-1 tabular-nums">
                <Phone className="h-3 w-3" aria-hidden="true" />
                {p.contacto_telefono}
              </p>
            )}
            {p.contacto_email && (
              <p className="flex items-center gap-1">
                <Mail className="h-3 w-3" aria-hidden="true" />
                {p.contacto_email}
              </p>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground/60">—</span>
        )}
      </td>
      <td className="max-w-[180px] truncate px-3 py-3 align-top text-xs text-muted-foreground">
        {p.condiciones_pago ?? <span className="text-muted-foreground/60">—</span>}
      </td>
      <td className="px-3 py-3 align-top">
        {p.activo ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Activo
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
            Inactivo
          </span>
        )}
      </td>
      {isAdmin && (
        <td className="px-4 py-3 align-top">
          <div className="flex justify-end gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onEdit}
              aria-label={`Editar ${p.nombre}`}
              title="Editar"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onToggle}
              disabled={toggling}
              aria-label={
                p.activo ? `Desactivar ${p.nombre}` : `Reactivar ${p.nombre}`
              }
              title={p.activo ? 'Desactivar' : 'Reactivar'}
            >
              {p.activo ? (
                <PowerOff className="h-4 w-4" />
              ) : (
                <Power className="h-4 w-4" />
              )}
            </Button>
          </div>
        </td>
      )}
    </tr>
  );
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
