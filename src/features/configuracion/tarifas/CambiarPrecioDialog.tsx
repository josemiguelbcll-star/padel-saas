import { useEffect, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { CalendarClock } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import type { UseMutationResult } from '@tanstack/react-query';
import type { Tarifa } from '@/types/database';
import type {
  CambiarPrecioInput,
  TarifaClaseOpcionInput,
} from '@/features/configuracion/hooks/useTarifas';
import type { TarifaLinaje } from './tarifaLineage';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const fechaFmt = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function fmtFecha(iso: string): string {
  return fechaFmt.format(new Date(iso + 'T00:00:00'));
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function previusDayISO(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface CambiarPrecioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linaje: TarifaLinaje | null;
  /**
   * Hook que devuelve la mutation para cambiar el precio. Inyectado por
   * el config del módulo (turnos o clases).
   */
  useCambiarPrecio: () => UseMutationResult<Tarifa, Error, CambiarPrecioInput>;
  soportaOpcionesClase?: boolean;
}

interface PrecioOpcionForm {
  nombre: string;
  monto: string;
}

const schema = z.object({
  monto_nuevo: z
    .number({ invalid_type_error: 'Ingresá un monto válido.' })
    .positive('El monto debe ser mayor a 0.'),
  vigente_desde: z.string().min(1, 'La fecha es obligatoria.'),
});

type FieldErrors = Partial<
  Record<'monto_nuevo' | 'vigente_desde' | 'opciones' | 'form', string>
>;

/**
 * Cambia el precio de un linaje. Cierra la versión vigente y crea una
 * nueva. Soporta aumentos programados (fecha futura). Atómico server-side.
 */
export function CambiarPrecioDialog({
  open,
  onOpenChange,
  linaje,
  useCambiarPrecio,
  soportaOpcionesClase = false,
}: CambiarPrecioDialogProps) {
  const cambiar = useCambiarPrecio();
  const [montoStr, setMontoStr] = useState('');
  const [vigenteDesde, setVigenteDesde] = useState(todayISO());
  const [opciones, setOpciones] = useState<PrecioOpcionForm[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});

  const pending = cambiar.isPending;

  useEffect(() => {
    if (open) {
      setMontoStr('');
      setVigenteDesde(todayISO());
      setOpciones([1, 2, 3].map((orden) => {
        const actual = linaje?.vigenteHoy?.opciones?.find(
          (opcion) => opcion.orden === orden,
        );
        return {
          nombre: actual?.nombre ?? `Opción ${orden}`,
          monto:
            actual?.monto != null
              ? String(actual.monto)
              : orden === 1 && linaje?.vigenteHoy
                ? String(linaje.vigenteHoy.monto)
                : '',
        };
      }));
      setErrors({});
    }
  }, [open, linaje]);

  function handleOpenChange(next: boolean): void {
    if (pending) return;
    onOpenChange(next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});

    if (!linaje) return;
    if (!linaje.vigenteHoy) {
      setErrors({
        form: 'Este linaje no tiene una versión vigente hoy. Verificá las fechas.',
      });
      return;
    }

    const parsed = schema.safeParse({
      monto_nuevo: soportaOpcionesClase
        ? Number(opciones[0]?.monto)
        : montoStr.trim() === ''
          ? NaN
          : Number(montoStr),
      vigente_desde: vigenteDesde,
    });
    if (!parsed.success) {
      const fe: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const p = issue.path[0];
        if (p === 'monto_nuevo' || p === 'vigente_desde') {
          if (p === 'monto_nuevo' && soportaOpcionesClase) {
            fe.opciones = 'Completá las tres opciones con montos mayores a 0.';
          } else {
            fe[p] = issue.message;
          }
        }
      }
      setErrors(fe);
      return;
    }

    const opcionesInput: TarifaClaseOpcionInput[] | undefined =
      soportaOpcionesClase
        ? opciones.map((opcion, index) => ({
            orden: (index + 1) as 1 | 2 | 3,
            nombre: opcion.nombre.trim(),
            monto: Number(opcion.monto),
          }))
        : undefined;
    if (
      opcionesInput &&
      opcionesInput.some(
        (opcion) =>
          !opcion.nombre ||
          opcion.nombre.length > 80 ||
          !Number.isFinite(opcion.monto) ||
          opcion.monto <= 0,
      )
    ) {
      setErrors({
        opciones: 'Completá los tres nombres y montos con valores mayores a 0.',
      });
      return;
    }

    try {
      await cambiar.mutateAsync({
        lineage_id: linaje.lineage_id,
        monto_nuevo: parsed.data.monto_nuevo,
        vigente_desde: parsed.data.vigente_desde,
        ...(opcionesInput ? { opciones: opcionesInput } : {}),
      });
      onOpenChange(false);
    } catch (err) {
      setErrors({
        form: err instanceof Error ? err.message : 'No pudimos cambiar el precio.',
      });
    }
  }

  if (!linaje) return null;

  const actual = linaje.vigenteHoy;
  const esHoy = vigenteDesde === todayISO();
  const fechaCierreActual = actual && vigenteDesde > actual.vigente_desde
    ? previusDayISO(vigenteDesde)
    : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={cn('max-w-md', soportaOpcionesClase && 'max-w-2xl')}>
        <DialogHeader>
          <DialogTitle>Cambiar precio · {linaje.nombre}</DialogTitle>
          <DialogDescription>
            {soportaOpcionesClase
              ? 'Se cierra la versión actual y se crea otra con los tres precios totales de la clase.'
              : 'El precio actual queda cerrado y se crea una nueva versión. Las reservas pendientes futuras sin cobros (incluyendo turnos fijos) se sincronizarán automáticamente con este nuevo precio.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {/* Precio actual de referencia */}
          {actual && (
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
              <p className="text-xs text-muted-foreground">Precio actual</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                {currencyFmt.format(actual.monto)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Vigente desde {fmtFecha(actual.vigente_desde)}
              </p>
            </div>
          )}

          {soportaOpcionesClase ? (
            <div className="space-y-2">
              <Label>Precios totales de la clase</Label>
              <div className="grid gap-2 sm:grid-cols-3">
                {opciones.map((opcion, index) => (
                  <div key={index} className="space-y-1 rounded-md border border-border p-2">
                    <Label htmlFor={`precio-opcion-nombre-${index + 1}`}>
                      Opción {index + 1} · nombre
                    </Label>
                    <Input
                      id={`precio-opcion-nombre-${index + 1}`}
                      value={opcion.nombre}
                      onChange={(e) =>
                        setOpciones((actuales) =>
                          actuales.map((actual, i) =>
                            i === index ? { ...actual, nombre: e.target.value } : actual,
                          ),
                        )
                      }
                      maxLength={80}
                      disabled={pending}
                      placeholder={`Ej: ${['Básica', 'Intermedia', 'Completa'][index]}`}
                    />
                    <Label htmlFor={`precio-opcion-monto-${index + 1}`}>Total</Label>
                    <Input
                      id={`precio-opcion-monto-${index + 1}`}
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0.01"
                      value={opcion.monto}
                      onChange={(e) =>
                        setOpciones((actuales) =>
                          actuales.map((actual, i) =>
                            i === index ? { ...actual, monto: e.target.value } : actual,
                          ),
                        )
                      }
                      disabled={pending}
                      placeholder="0.00"
                    />
                  </div>
                ))}
              </div>
              {errors.opciones && (
                <p role="alert" className="text-xs text-destructive">{errors.opciones}</p>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              <Label htmlFor="precio-nuevo">Precio nuevo</Label>
              <Input
                id="precio-nuevo"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                value={montoStr}
                onChange={(e) => setMontoStr(e.target.value)}
                disabled={pending}
                autoFocus
                placeholder="0.00"
                aria-invalid={!!errors.monto_nuevo}
              />
              {errors.monto_nuevo && (
                <p role="alert" className="text-xs text-destructive">
                  {errors.monto_nuevo}
                </p>
              )}
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="precio-vigente">Desde</Label>
            <Input
              id="precio-vigente"
              type="date"
              value={vigenteDesde}
              min={todayISO()}
              onChange={(e) => setVigenteDesde(e.target.value)}
              disabled={pending}
              aria-invalid={!!errors.vigente_desde}
            />
            {errors.vigente_desde && (
              <p role="alert" className="text-xs text-destructive">
                {errors.vigente_desde}
              </p>
            )}
          </div>

          {/* Preview del cambio */}
          {actual && fechaCierreActual && (
            <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
              <CalendarClock
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"
                aria-hidden="true"
              />
              <div className="space-y-1">
                <p className="text-foreground">
                  El precio actual{' '}
                  <strong className="font-semibold">
                    {currencyFmt.format(actual.monto)}
                  </strong>{' '}
                  queda vigente hasta el{' '}
                  <strong className="font-semibold">{fmtFecha(fechaCierreActual)}</strong>.
                </p>
                <p className="text-muted-foreground">
                  Desde el {fmtFecha(vigenteDesde)}{' '}
                  {esHoy ? '(hoy)' : '(programado)'} rige el precio nuevo.
                </p>
              </div>
            </div>
          )}

          {errors.form && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
            >
              {errors.form}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Aplicando…' : 'Aplicar cambio'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
