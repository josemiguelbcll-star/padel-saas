import { useState } from 'react';
import { Info, Pencil, Plus, Power, PowerOff, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSession } from '@/features/auth';
import {
  useActualizarCuenta,
  useCuentas,
} from '@/features/configuracion/hooks/useCuentas';
import type { CuentaConSaldo, TipoCuenta } from '@/types/database';
import { CuentaFormDialog } from './CuentaFormDialog';
import { MediosCuentaSection } from './MediosCuentaSection';

const TIPO_LABEL: Record<TipoCuenta, string> = {
  efectivo: 'Efectivo',
  banco: 'Banco',
  billetera: 'Billetera',
  otro: 'Otro',
};

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function TesoreriaPage() {
  const { user } = useSession();
  const isAdmin = user?.rol === 'admin';

  const cuentasQuery = useCuentas();
  const actualizarMutation = useActualizarCuenta();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CuentaConSaldo | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const cuentas = cuentasQuery.data ?? [];

  function openNew(): void {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(c: CuentaConSaldo): void {
    setEditing(c);
    setFormOpen(true);
  }

  async function toggleActiva(c: CuentaConSaldo): Promise<void> {
    setToggleError(null);
    try {
      await actualizarMutation.mutateAsync({
        id: c.id,
        changes: { activa: !c.activa },
      });
    } catch (err) {
      setToggleError(
        err instanceof Error
          ? err.message
          : 'No pudimos cambiar el estado de la cuenta.',
      );
    }
  }

  return (
    <section className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
            <Wallet className="h-5 w-5 text-primary" aria-hidden="true" />
            Cuentas
          </h2>
          <p className="text-sm text-muted-foreground">
            Dónde está la plata del club: efectivo en el cajón, bancos,
            billeteras. El medio de pago dice "cómo" llegó; la cuenta, "dónde"
            quedó.
          </p>
        </div>
        {isAdmin && (
          <Button type="button" onClick={openNew} className="shrink-0">
            <Plus className="h-4 w-4" />
            Nueva cuenta
          </Button>
        )}
      </header>

      {/* Nota honesta sobre el saldo en esta etapa */}
      <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <p className="text-muted-foreground">
          Por ahora el saldo que se muestra es el{' '}
          <strong className="text-foreground">saldo inicial</strong> que cargaste.
          Los movimientos (cobros y pagos) se sumarán al saldo cuando conectemos
          las cuentas a los cobros — eso es la próxima etapa. No estamos
          mostrando datos que todavía no existen.
        </p>
      </div>

      {toggleError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {toggleError}
        </div>
      )}

      <CuentasTable
        query={cuentasQuery}
        cuentas={cuentas}
        isAdmin={isAdmin}
        toggling={actualizarMutation.isPending}
        onEdit={openEdit}
        onToggle={(c) => {
          void toggleActiva(c);
        }}
      />

      <MediosCuentaSection cuentas={cuentas} isAdmin={isAdmin} />

      <CuentaFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initialValue={editing}
      />
    </section>
  );
}

interface CuentasTableProps {
  query: ReturnType<typeof useCuentas>;
  cuentas: CuentaConSaldo[];
  isAdmin: boolean;
  toggling: boolean;
  onEdit: (c: CuentaConSaldo) => void;
  onToggle: (c: CuentaConSaldo) => void;
}

function CuentasTable({
  query,
  cuentas,
  isAdmin,
  toggling,
  onEdit,
  onToggle,
}: CuentasTableProps) {
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

  if (cuentas.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center">
        <Wallet className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <p className="mt-2 text-sm text-muted-foreground">
          {isAdmin
            ? 'Agregá las cuentas del club con "Nueva cuenta" (Efectivo ya debería estar; sumá tus bancos y billeteras).'
            : 'El administrador todavía no configuró las cuentas del club.'}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/20 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2 font-semibold">Cuenta</th>
              <th className="px-3 py-2 font-semibold">Tipo</th>
              <th className="px-3 py-2 text-right font-semibold">Saldo inicial</th>
              <th className="px-3 py-2 font-semibold">Estado</th>
              {isAdmin && (
                <th className="w-1 px-4 py-2 text-right">
                  <span className="sr-only">Acciones</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {cuentas.map((c) => (
              <CuentaRow
                key={c.id}
                c={c}
                isAdmin={isAdmin}
                toggling={toggling}
                onEdit={() => onEdit(c)}
                onToggle={() => onToggle(c)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface CuentaRowProps {
  c: CuentaConSaldo;
  isAdmin: boolean;
  toggling: boolean;
  onEdit: () => void;
  onToggle: () => void;
}

function CuentaRow({ c, isAdmin, toggling, onEdit, onToggle }: CuentaRowProps) {
  return (
    <tr
      className={cn(
        'border-b border-border/50 transition-colors last:border-b-0 hover:bg-muted/20',
        !c.activa && 'bg-muted/20',
      )}
    >
      <td className="px-4 py-3 align-top">
        <div className="flex items-center gap-2">
          <p
            className={cn(
              'font-medium',
              c.activa ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {c.nombre}
          </p>
          {c.es_caja_fisica && (
            <span
              className="inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
              title="Se cuenta en el arqueo del cajón"
            >
              Caja física
            </span>
          )}
        </div>
        {c.detalle && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">{c.detalle}</p>
        )}
      </td>
      <td className="px-3 py-3 align-top text-xs text-muted-foreground">
        {TIPO_LABEL[c.tipo]}
      </td>
      <td className="px-3 py-3 text-right align-top font-medium tabular-nums text-foreground">
        {currencyFmt.format(c.saldo)}
      </td>
      <td className="px-3 py-3 align-top">
        {c.activa ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Activa
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
            Inactiva
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
              aria-label={`Editar ${c.nombre}`}
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
              aria-label={c.activa ? `Desactivar ${c.nombre}` : `Reactivar ${c.nombre}`}
              title={c.activa ? 'Desactivar' : 'Reactivar'}
            >
              {c.activa ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
            </Button>
          </div>
        </td>
      )}
    </tr>
  );
}
