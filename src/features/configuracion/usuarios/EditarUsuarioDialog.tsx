import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
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
import { useActualizarUsuario } from '@/features/configuracion/hooks/useActualizarUsuario';
import type { Rol, Usuario } from '@/types/database';
import { editarUsuarioSchema } from './usuarioSchema';
import { SECCIONES_PERMISOS } from '@/lib/permisos';

interface EditarUsuarioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  usuario: Usuario;
  /** Si este usuario es el último admin activo del club. */
  esUltimoAdminActivo: boolean;
  /** Si este usuario es el que está logueado actualmente. */
  esYo: boolean;
}

type FieldErrors = Partial<Record<'nombre' | 'rol' | 'form', string>>;

/**
 * Modal para editar nombre y rol de un usuario. Incluye sección de
 * activar/desactivar con confirmación inline.
 */
export function EditarUsuarioDialog({
  open,
  onOpenChange,
  usuario,
  esUltimoAdminActivo,
  esYo,
}: EditarUsuarioDialogProps) {
  const actualizar = useActualizarUsuario();

  const [nombre, setNombre] = useState(usuario.nombre);
  const [rol, setRol] = useState<Rol>(usuario.rol);
  const [permisos, setPermisos] = useState<any>(usuario.permisos || {});
  const [confirmingDesactivar, setConfirmingDesactivar] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  const pending = actualizar.isPending;

  // Resync cuando cambia el usuario (otro click en Editar) o cuando
  // se reabre.
  useEffect(() => {
    if (open) {
      setNombre(usuario.nombre);
      setRol(usuario.rol);
      setPermisos(usuario.permisos || {});
      setConfirmingDesactivar(false);
      setErrors({});
    }
  }, [open, usuario.id, usuario.nombre, usuario.rol, usuario.permisos]);

  function handleOpenChange(next: boolean): void {
    if (pending) return;
    onOpenChange(next);
  }

  async function handleGuardar(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});

    const parsed = editarUsuarioSchema.safeParse({ nombre, rol });
    if (!parsed.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path[0];
        if (path === 'nombre' || path === 'rol') {
          fieldErrors[path] = issue.message;
        }
      }
      setErrors(fieldErrors);
      return;
    }

    const changes: { nombre?: string; rol?: Rol; permisos?: any } = {};
    if (parsed.data.nombre !== usuario.nombre) changes.nombre = parsed.data.nombre;
    if (parsed.data.rol !== usuario.rol) changes.rol = parsed.data.rol;
    if (rol === 'vendedor' && JSON.stringify(permisos) !== JSON.stringify(usuario.permisos)) {
      changes.permisos = permisos;
    }

    if (Object.keys(changes).length === 0) {
      onOpenChange(false);
      return;
    }

    try {
      await actualizar.mutateAsync({ id: usuario.id, changes });
      onOpenChange(false);
    } catch (err) {
      setErrors({
        form:
          err instanceof Error
            ? err.message
            : 'No pudimos guardar los cambios.',
      });
    }
  }

  async function handleConfirmDesactivar(): Promise<void> {
    setErrors({});
    try {
      await actualizar.mutateAsync({
        id: usuario.id,
        changes: { activo: false },
      });
      onOpenChange(false);
    } catch (err) {
      setErrors({
        form:
          err instanceof Error
            ? err.message
            : 'No pudimos desactivar el usuario.',
      });
      setConfirmingDesactivar(false);
    }
  }

  async function handleReactivar(): Promise<void> {
    setErrors({});
    try {
      await actualizar.mutateAsync({
        id: usuario.id,
        changes: { activo: true },
      });
      onOpenChange(false);
    } catch (err) {
      setErrors({
        form:
          err instanceof Error
            ? err.message
            : 'No pudimos reactivar el usuario.',
      });
    }
  }

  // Reglas de UI:
  //   - "Vendedor" deshabilitado si es último admin activo (degradación bloqueada).
  //   - Botón Desactivar oculto si es último admin activo.
  //   - Warning extra si te desactivás a vos mismo.
  const degradacionBloqueada = esUltimoAdminActivo;
  const desactivacionBloqueada = esUltimoAdminActivo;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar usuario</DialogTitle>
          <DialogDescription>
            {usuario.email ?? 'Sin email'}
            {esYo && ' (vos)'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleGuardar} className="space-y-4" noValidate>
          <div className="space-y-1">
            <Label htmlFor="editar-usuario-nombre">Nombre</Label>
            <Input
              id="editar-usuario-nombre"
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              disabled={pending}
              maxLength={120}
              autoComplete="name"
              aria-invalid={!!errors.nombre}
              aria-describedby={errors.nombre ? 'err-nombre-edit' : undefined}
            />
            {errors.nombre && (
              <p
                id="err-nombre-edit"
                role="alert"
                className="text-xs text-destructive"
              >
                {errors.nombre}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label>Rol</Label>
            <div className="flex gap-2">
              <RolPill
                label="Vendedor"
                active={rol === 'vendedor'}
                disabled={pending || degradacionBloqueada}
                onClick={() => setRol('vendedor')}
                title={
                  degradacionBloqueada
                    ? 'No se puede degradar al último admin activo del club.'
                    : undefined
                }
              />
              <RolPill
                label="Admin"
                active={rol === 'admin'}
                disabled={pending}
                onClick={() => setRol('admin')}
              />
            </div>
            {degradacionBloqueada && (
              <p className="text-[11px] text-muted-foreground">
                Es el último admin activo del club — no se puede degradar
                hasta que asignes otro admin.
              </p>
            )}
            {errors.rol && (
              <p role="alert" className="text-xs text-destructive">
                {errors.rol}
              </p>
            )}
          </div>

          {rol === 'vendedor' && (
            <div className="space-y-3 rounded-md border border-border p-3 bg-muted/20">
              <div>
                <Label className="text-sm font-semibold">Permisos del vendedor</Label>
                <p className="text-xs text-muted-foreground">
                  Definí a qué módulos tiene acceso y si puede realizar modificaciones.
                </p>
              </div>

              <div className="space-y-3 pt-2">
                {SECCIONES_PERMISOS.map((seccion) => {
                  const config = permisos?.modulos?.[seccion.key] || {
                    ver: seccion.key !== 'inventario',
                    editar: seccion.key !== 'inventario' && seccion.key !== 'configuracion',
                  };

                  const handleToggle = (tipo: 'ver' | 'editar', checked: boolean) => {
                    const currentConfig = {
                      ...(permisos?.modulos?.[seccion.key] || config),
                      [tipo]: checked,
                    };

                    if (tipo === 'ver' && !checked) {
                      currentConfig.editar = false;
                    }
                    if (tipo === 'editar' && checked) {
                      currentConfig.ver = true;
                    }

                    setPermisos((prev: any) => ({
                      ...prev,
                      modulos: {
                        ...(prev?.modulos || {}),
                        [seccion.key]: currentConfig,
                      },
                    }));
                  };

                  return (
                    <div key={seccion.key} className="flex flex-col gap-1 border-b border-border/50 pb-2 last:border-0 last:pb-0">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-xs font-medium text-foreground">{seccion.label}</span>
                          <p className="text-[10px] text-muted-foreground leading-tight max-w-[280px]">
                            {seccion.descripcion}
                          </p>
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              id={`perm-${seccion.key}-ver`}
                              checked={config.ver}
                              onChange={(e) => handleToggle('ver', e.target.checked)}
                              className="h-3.5 w-3.5 rounded border-input text-primary focus:ring-primary"
                            />
                            <Label htmlFor={`perm-${seccion.key}-ver`} className="text-[11px] font-normal cursor-pointer select-none">
                              Ver
                            </Label>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              id={`perm-${seccion.key}-editar`}
                              checked={config.editar}
                              disabled={!config.ver}
                              onChange={(e) => handleToggle('editar', e.target.checked)}
                              className="h-3.5 w-3.5 rounded border-input text-primary focus:ring-primary disabled:opacity-50"
                            />
                            <Label 
                              htmlFor={`perm-${seccion.key}-editar`} 
                              className={cn(
                                "text-[11px] font-normal cursor-pointer select-none",
                                !config.ver && "text-muted-foreground cursor-not-allowed"
                              )}
                            >
                              Editar
                            </Label>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
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

          <DialogFooter className="sm:justify-between">
            {/* Bloque de activar/desactivar a la izquierda */}
            <div className="flex items-center">
              {usuario.activo ? (
                !desactivacionBloqueada ? (
                  confirmingDesactivar ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        ¿Desactivar?
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmingDesactivar(false)}
                        disabled={pending}
                      >
                        No
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          void handleConfirmDesactivar();
                        }}
                        disabled={pending}
                      >
                        {pending ? 'Desactivando…' : 'Sí, desactivar'}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmingDesactivar(true)}
                      disabled={pending}
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      Desactivar
                    </Button>
                  )
                ) : null
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void handleReactivar();
                  }}
                  disabled={pending}
                >
                  Reactivar
                </Button>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleOpenChange(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Guardando…' : 'Guardar'}
              </Button>
            </div>
          </DialogFooter>

          {/* Warning extra si me estoy desactivando a mí mismo */}
          {esYo && confirmingDesactivar && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs"
            >
              <AlertTriangle
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive"
                aria-hidden="true"
              />
              <span className="text-foreground">
                Te estás desactivando a vos mismo. Si confirmás, vas a
                perder acceso inmediato y otro admin va a tener que
                reactivarte.
              </span>
            </div>
          )}

          {/* Hint sobre el último admin */}
          {desactivacionBloqueada && (
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                Es el último admin activo del club — no se puede desactivar.
                Asigná otro admin antes.
              </span>
            </div>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RolPill({
  label,
  active,
  disabled,
  onClick,
  title,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={title}
      className={cn(
        'rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-foreground hover:bg-muted',
      )}
    >
      {label}
    </button>
  );
}
