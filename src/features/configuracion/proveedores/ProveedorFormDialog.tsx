import { useState, type FormEvent } from 'react';
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
  useCreateProveedor,
  useUpdateProveedor,
  type ProveedorInput,
} from '@/features/configuracion/hooks/useProveedores';
import type { Proveedor } from '@/types/database';
import {
  proveedorSchema,
  type ProveedorFormState,
} from './proveedorSchema';

interface ProveedorFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValue: Proveedor | null;
}

export function ProveedorFormDialog({
  open,
  onOpenChange,
  initialValue,
}: ProveedorFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <ProveedorFormBody
          key={initialValue?.id ?? 'new'}
          initialValue={initialValue}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

type FieldErrors = Partial<Record<keyof ProveedorFormState | 'form', string>>;

const EMPTY_STATE: ProveedorFormState = {
  nombre: '',
  cuit: '',
  contacto_persona: '',
  contacto_telefono: '',
  contacto_email: '',
  condiciones_pago: '',
  que_provee: '',
  notas: '',
  activo: true,
};

function proveedorToFormState(p: Proveedor): ProveedorFormState {
  return {
    nombre: p.nombre,
    cuit: p.cuit ?? '',
    contacto_persona: p.contacto_persona ?? '',
    contacto_telefono: p.contacto_telefono ?? '',
    contacto_email: p.contacto_email ?? '',
    condiciones_pago: p.condiciones_pago ?? '',
    que_provee: p.que_provee ?? '',
    notas: p.notas ?? '',
    activo: p.activo,
  };
}

interface ProveedorFormBodyProps {
  initialValue: Proveedor | null;
  onDone: () => void;
}

function ProveedorFormBody({ initialValue, onDone }: ProveedorFormBodyProps) {
  const isEdit = initialValue !== null;
  const createMutation = useCreateProveedor();
  const updateMutation = useUpdateProveedor();

  const [state, setState] = useState<ProveedorFormState>(
    initialValue ? proveedorToFormState(initialValue) : EMPTY_STATE,
  );
  const [errors, setErrors] = useState<FieldErrors>({});

  const isPending = createMutation.isPending || updateMutation.isPending;

  function setField<K extends keyof ProveedorFormState>(
    key: K,
    value: ProveedorFormState[K],
  ): void {
    setState((s) => ({ ...s, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});

    const parsed = proveedorSchema.safeParse(state);
    if (!parsed.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (
          field === 'nombre' ||
          field === 'cuit' ||
          field === 'contacto_persona' ||
          field === 'contacto_telefono' ||
          field === 'contacto_email' ||
          field === 'condiciones_pago' ||
          field === 'que_provee' ||
          field === 'notas' ||
          field === 'activo'
        ) {
          fieldErrors[field] = issue.message;
        } else {
          fieldErrors.form = issue.message;
        }
      }
      setErrors(fieldErrors);
      return;
    }

    // El hook normaliza "" → null antes del insert/update. Pasamos los
    // valores del schema directo (todos los strings, activo bool).
    const payload: ProveedorInput = {
      nombre: parsed.data.nombre,
      cuit: parsed.data.cuit,
      contacto_persona: parsed.data.contacto_persona,
      contacto_telefono: parsed.data.contacto_telefono,
      contacto_email: parsed.data.contacto_email,
      condiciones_pago: parsed.data.condiciones_pago,
      que_provee: parsed.data.que_provee,
      notas: parsed.data.notas,
      activo: parsed.data.activo,
    };

    try {
      if (isEdit && initialValue) {
        await updateMutation.mutateAsync({
          id: initialValue.id,
          changes: payload,
        });
      } else {
        await createMutation.mutateAsync(payload);
      }
      onDone();
    } catch (err) {
      setErrors({
        form:
          err instanceof Error
            ? err.message
            : 'No pudimos guardar el proveedor. Probá de nuevo.',
      });
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {isEdit ? 'Editar proveedor' : 'Nuevo proveedor'}
        </DialogTitle>
        <DialogDescription>
          {isEdit
            ? 'Modificá los datos del proveedor. Todos los campos excepto el nombre son opcionales — completá los que tengas.'
            : 'Cargá un proveedor al catálogo. Solo el nombre es obligatorio; el resto lo podés completar después.'}
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="prov-nombre">
            Nombre <span className="text-destructive">*</span>
          </Label>
          <Input
            id="prov-nombre"
            value={state.nombre}
            onChange={(e) => setField('nombre', e.target.value)}
            maxLength={120}
            disabled={isPending}
            autoFocus
            required
            aria-invalid={errors.nombre ? true : undefined}
            placeholder="Ej: Distribuidora La Esquina"
          />
          {errors.nombre && (
            <p className="text-xs text-destructive">{errors.nombre}</p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FieldBlock
            id="prov-cuit"
            label="CUIT"
            error={errors.cuit}
          >
            <Input
              id="prov-cuit"
              value={state.cuit}
              onChange={(e) => setField('cuit', e.target.value)}
              maxLength={20}
              disabled={isPending}
              aria-invalid={errors.cuit ? true : undefined}
              placeholder="Ej: 30-12345678-9"
              inputMode="numeric"
            />
          </FieldBlock>

          <FieldBlock
            id="prov-contacto-persona"
            label="Persona de contacto"
            error={errors.contacto_persona}
          >
            <Input
              id="prov-contacto-persona"
              value={state.contacto_persona}
              onChange={(e) => setField('contacto_persona', e.target.value)}
              maxLength={120}
              disabled={isPending}
              aria-invalid={errors.contacto_persona ? true : undefined}
              placeholder="Ej: Juan Pérez"
            />
          </FieldBlock>

          <FieldBlock
            id="prov-telefono"
            label="Teléfono"
            error={errors.contacto_telefono}
          >
            <Input
              id="prov-telefono"
              type="tel"
              value={state.contacto_telefono}
              onChange={(e) => setField('contacto_telefono', e.target.value)}
              maxLength={40}
              disabled={isPending}
              aria-invalid={errors.contacto_telefono ? true : undefined}
              placeholder="Ej: 11 5555-5555"
            />
          </FieldBlock>

          <FieldBlock
            id="prov-email"
            label="Email"
            error={errors.contacto_email}
          >
            <Input
              id="prov-email"
              type="email"
              value={state.contacto_email}
              onChange={(e) => setField('contacto_email', e.target.value)}
              maxLength={120}
              disabled={isPending}
              aria-invalid={errors.contacto_email ? true : undefined}
              placeholder="ventas@proveedor.com"
            />
          </FieldBlock>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FieldBlock
            id="prov-que-provee"
            label="Qué provee"
            error={errors.que_provee}
            hint="Texto libre. Ej: bebidas y snacks; pelotas y palas; alfajores."
          >
            <textarea
              id="prov-que-provee"
              value={state.que_provee}
              onChange={(e) => setField('que_provee', e.target.value)}
              maxLength={1000}
              disabled={isPending}
              aria-invalid={errors.que_provee ? true : undefined}
              rows={2}
              className={cn(
                'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
              placeholder="Ej: gaseosas, aguas, snacks salados"
            />
          </FieldBlock>

          <FieldBlock
            id="prov-condiciones"
            label="Condiciones de pago"
            error={errors.condiciones_pago}
            hint="Texto libre. Ej: 30/60/90, contado contra entrega, FOB 15 días."
          >
            <textarea
              id="prov-condiciones"
              value={state.condiciones_pago}
              onChange={(e) => setField('condiciones_pago', e.target.value)}
              maxLength={1000}
              disabled={isPending}
              aria-invalid={errors.condiciones_pago ? true : undefined}
              rows={2}
              className={cn(
                'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            />
          </FieldBlock>
        </div>

        <FieldBlock
          id="prov-notas"
          label="Notas"
          error={errors.notas}
          hint="Cualquier cosa que quieras recordar de este proveedor."
        >
          <textarea
            id="prov-notas"
            value={state.notas}
            onChange={(e) => setField('notas', e.target.value)}
            maxLength={2000}
            disabled={isPending}
            aria-invalid={errors.notas ? true : undefined}
            rows={3}
            className={cn(
              'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          />
        </FieldBlock>

        <div className="flex items-center justify-between rounded-md border border-border p-3">
          <div>
            <Label htmlFor="prov-activo" className="cursor-pointer">
              Activo
            </Label>
            <p className="text-xs text-muted-foreground">
              Si está apagado, no va a aparecer como opción al cargar
              compras (cuando exista ese módulo).
            </p>
          </div>
          <Switch
            id="prov-activo"
            checked={state.activo}
            onCheckedChange={(v) => setField('activo', v)}
            disabled={isPending}
          />
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
          <Button
            type="button"
            variant="outline"
            onClick={onDone}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending
              ? 'Guardando…'
              : isEdit
                ? 'Guardar cambios'
                : 'Crear proveedor'}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

interface FieldBlockProps {
  id: string;
  label: string;
  error: string | undefined;
  hint?: string;
  children: React.ReactNode;
}

function FieldBlock({ id, label, error, hint, children }: FieldBlockProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
