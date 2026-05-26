import { useState, type FormEvent } from 'react';
import { Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  useActualizarCuenta,
  useCrearCuenta,
  type CuentaInput,
} from '@/features/configuracion/hooks/useCuentas';
import type { Cuenta } from '@/types/database';
import { cuentaSchema, TIPOS_CUENTA, type CuentaFormState } from './cuentaSchema';

interface CuentaFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValue: Cuenta | null;
}

export function CuentaFormDialog({
  open,
  onOpenChange,
  initialValue,
}: CuentaFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <CuentaFormBody
          key={initialValue?.id ?? 'new'}
          initialValue={initialValue}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

type FieldErrors = Partial<Record<keyof CuentaFormState | 'form', string>>;

const EMPTY_STATE: CuentaFormState = {
  nombre: '',
  tipo: 'banco',
  saldo_inicial: '0',
  detalle: '',
  es_caja_fisica: false,
  orden: '0',
  activa: true,
};

function cuentaToFormState(c: Cuenta): CuentaFormState {
  return {
    nombre: c.nombre,
    tipo: c.tipo,
    saldo_inicial: String(c.saldo_inicial),
    detalle: c.detalle ?? '',
    es_caja_fisica: c.es_caja_fisica,
    orden: String(c.orden),
    activa: c.activa,
  };
}

interface CuentaFormBodyProps {
  initialValue: Cuenta | null;
  onDone: () => void;
}

function CuentaFormBody({ initialValue, onDone }: CuentaFormBodyProps) {
  const isEdit = initialValue !== null;
  const crearMutation = useCrearCuenta();
  const actualizarMutation = useActualizarCuenta();

  const [state, setState] = useState<CuentaFormState>(
    initialValue ? cuentaToFormState(initialValue) : EMPTY_STATE,
  );
  const [errors, setErrors] = useState<FieldErrors>({});

  const isPending = crearMutation.isPending || actualizarMutation.isPending;

  function setField<K extends keyof CuentaFormState>(
    key: K,
    value: CuentaFormState[K],
  ): void {
    setState((s) => ({ ...s, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});

    const parsed = cuentaSchema.safeParse(state);
    if (!parsed.success) {
      const fe: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const f = issue.path[0];
        if (
          f === 'nombre' || f === 'tipo' || f === 'saldo_inicial' ||
          f === 'detalle' || f === 'es_caja_fisica' || f === 'orden' ||
          f === 'activa'
        ) {
          fe[f] = issue.message;
        } else {
          fe.form = issue.message;
        }
      }
      setErrors(fe);
      return;
    }

    const payload: CuentaInput = {
      nombre: parsed.data.nombre,
      tipo: parsed.data.tipo,
      saldo_inicial: parsed.data.saldo_inicial,
      detalle: parsed.data.detalle === '' ? null : parsed.data.detalle,
      es_caja_fisica: parsed.data.es_caja_fisica,
      orden: parsed.data.orden,
      activa: parsed.data.activa,
    };

    try {
      if (isEdit && initialValue) {
        await actualizarMutation.mutateAsync({ id: initialValue.id, changes: payload });
      } else {
        await crearMutation.mutateAsync(payload);
      }
      onDone();
    } catch (err) {
      setErrors({
        form:
          err instanceof Error
            ? err.message
            : 'No pudimos guardar la cuenta. Probá de nuevo.',
      });
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-primary" aria-hidden="true" />
          {isEdit ? 'Editar cuenta' : 'Nueva cuenta'}
        </DialogTitle>
        <DialogDescription>
          Una cuenta es "dónde" está la plata del club (efectivo en el cajón,
          un banco, Mercado Pago…). El medio de pago dice "cómo" llegó.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="cta-nombre">
            Nombre <span className="text-destructive">*</span>
          </Label>
          <Input
            id="cta-nombre"
            value={state.nombre}
            onChange={(e) => setField('nombre', e.target.value)}
            maxLength={80}
            disabled={isPending}
            autoFocus
            aria-invalid={errors.nombre ? true : undefined}
            placeholder="Ej: Banco Galicia, Mercado Pago, Efectivo"
          />
          {errors.nombre && <p className="text-xs text-destructive">{errors.nombre}</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cta-tipo" className="text-xs">Tipo</Label>
            <select
              id="cta-tipo"
              value={state.tipo}
              onChange={(e) => setField('tipo', e.target.value as CuentaFormState['tipo'])}
              disabled={isPending}
              className={cn(
                'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              {TIPOS_CUENTA.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cta-saldo" className="text-xs">Saldo inicial</Label>
            <Input
              id="cta-saldo"
              type="number"
              step="0.01"
              value={state.saldo_inicial}
              onChange={(e) => setField('saldo_inicial', e.target.value)}
              disabled={isPending}
              aria-invalid={errors.saldo_inicial ? true : undefined}
              inputMode="decimal"
            />
            {errors.saldo_inicial ? (
              <p className="text-xs text-destructive">{errors.saldo_inicial}</p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Lo que hay en la cuenta hoy, al empezar a usar tesorería.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cta-detalle" className="text-xs">Detalle (opcional)</Label>
          <Input
            id="cta-detalle"
            value={state.detalle}
            onChange={(e) => setField('detalle', e.target.value)}
            maxLength={120}
            disabled={isPending}
            aria-invalid={errors.detalle ? true : undefined}
            placeholder="CBU, alias o nº de cuenta"
          />
          {errors.detalle && <p className="text-xs text-destructive">{errors.detalle}</p>}
        </div>

        {/* es_caja_fisica — explicación en lenguaje del usuario */}
        <div className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="cta-caja" className="cursor-pointer">
              Es caja física (entra al arqueo)
            </Label>
            <p className="text-xs text-muted-foreground">
              Marcala si es plata en <strong>efectivo en el cajón</strong> del
              mostrador: se cuenta en el arqueo al cerrar la caja. Las cuentas
              de banco o billetera NO se marcan.
            </p>
          </div>
          <Switch
            id="cta-caja"
            checked={state.es_caja_fisica}
            onCheckedChange={(v) => setField('es_caja_fisica', v)}
            disabled={isPending}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cta-orden" className="text-xs">Orden</Label>
            <Input
              id="cta-orden"
              type="number"
              step="1"
              min={0}
              value={state.orden}
              onChange={(e) => setField('orden', e.target.value)}
              disabled={isPending}
              aria-invalid={errors.orden ? true : undefined}
              inputMode="numeric"
            />
            {errors.orden ? (
              <p className="text-xs text-destructive">{errors.orden}</p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Orden en las listas (menor primero).
              </p>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 self-end rounded-md border border-border p-3">
            <Label htmlFor="cta-activa" className="cursor-pointer">Activa</Label>
            <Switch
              id="cta-activa"
              checked={state.activa}
              onCheckedChange={(v) => setField('activa', v)}
              disabled={isPending}
            />
          </div>
        </div>

        {errors.form && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {errors.form}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear cuenta'}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
