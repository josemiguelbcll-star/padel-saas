import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, Check, ImageIcon, Info, Upload, X } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  ALLOWED_LOGO_MIMES,
  getLogoClubUrl,
  PALETA_COLORES_MARCA,
} from '@/lib/clubBrand';
import { useSession } from '@/features/auth';
import { useActualizarMarcaClub } from '@/features/configuracion/hooks/useActualizarMarcaClub';
import { useSubirLogoClub } from '@/features/configuracion/hooks/useSubirLogoClub';
import { useQuitarLogoClub } from '@/features/configuracion/hooks/useQuitarLogoClub';

const nombreClubSchema = z
  .string()
  .trim()
  .min(1, 'El nombre del club no puede quedar vacío.')
  .max(120, 'El nombre puede tener hasta 120 caracteres.');

/**
 * Pantalla "Marca" del módulo Configuración (Nivel 2 — etapa 1: color
 * + nombre). Permite al admin del club:
 *
 *   - Renombrar el club (input + Guardar, validación zod).
 *   - Elegir un color de marca de la paleta curada (`PALETA_COLORES_MARCA`).
 *     Click en un swatch persiste y aplica EN VIVO — no hay botón
 *     "guardar" separado para el color. El useEffect del SessionProvider
 *     suscripto al cambio de `color_primario_hsl` actualiza el token
 *     `--primary` y reescribe el cache de localStorage.
 *
 * Permisos: solo admin puede editar (RLS + GRANT column-level lo
 * protegen del lado server; la UI desabilita los controles y muestra
 * un mensaje para vendedores).
 *
 * Etapa 2 (futura): upload de logo via Storage.
 */
export function MarcaPage() {
  const { club, user } = useSession();
  const isAdmin = user?.rol === 'admin';
  const mutation = useActualizarMarcaClub();

  const [nombre, setNombre] = useState<string>(club?.nombre ?? '');
  const [nombreError, setNombreError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Resync local cuando el club externo cambia (otro usuario editó,
  // o este mismo usuario acaba de guardar y el provider mergeó).
  useEffect(() => {
    if (club?.nombre !== undefined) setNombre(club.nombre);
  }, [club?.nombre]);

  if (!club) {
    return (
      <div className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
        Cargando datos del club…
      </div>
    );
  }

  const colorActual = club.color_primario_hsl;
  const nombreCambio = nombre.trim() !== club.nombre;
  const cualquierMutacionEnCurso = mutation.isPending;

  async function handleGuardarNombre(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setError(null);
    setNombreError(null);

    const parsed = nombreClubSchema.safeParse(nombre);
    if (!parsed.success) {
      setNombreError(parsed.error.errors[0]?.message ?? 'Nombre inválido.');
      return;
    }
    if (parsed.data === club!.nombre) return;

    try {
      await mutation.mutateAsync({ nombre: parsed.data });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No pudimos guardar el nombre del club.',
      );
    }
  }

  async function handleElegirColor(hsl: string): Promise<void> {
    if (hsl === colorActual) return;
    setError(null);
    try {
      await mutation.mutateAsync({ color_primario_hsl: hsl });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No pudimos guardar el color de marca.',
      );
    }
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">Marca</h1>
        <p className="text-sm text-muted-foreground">
          Identidad visual del club. El color elegido se aplica a los acentos
          de la app (botones, links activos, focus). El logo viene en una
          próxima actualización.
        </p>
      </header>

      {!isAdmin && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
        >
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Solo el administrador del club puede editar la marca. Podés
            verla pero no cambiarla.
          </span>
        </div>
      )}

      {/* ── Nombre ───────────────────────────────────────────────── */}
      <section className="space-y-2">
        <Label htmlFor="marca-nombre">Nombre del club</Label>
        <form
          onSubmit={handleGuardarNombre}
          className="flex flex-wrap items-start gap-2"
          noValidate
        >
          <div className="flex-1 min-w-[200px] space-y-1">
            <Input
              id="marca-nombre"
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              disabled={!isAdmin || cualquierMutacionEnCurso}
              maxLength={120}
              placeholder="Padel Center"
              aria-invalid={nombreError !== null}
              aria-describedby={nombreError ? 'marca-nombre-error' : undefined}
            />
            {nombreError && (
              <p
                id="marca-nombre-error"
                role="alert"
                className="text-xs text-destructive"
              >
                {nombreError}
              </p>
            )}
          </div>
          <Button
            type="submit"
            disabled={
              !isAdmin || !nombreCambio || cualquierMutacionEnCurso
            }
          >
            {cualquierMutacionEnCurso && nombreCambio
              ? 'Guardando…'
              : 'Guardar nombre'}
          </Button>
        </form>
      </section>

      {/* ── Color ────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <Label>Color de marca</Label>
        <p className="text-xs text-muted-foreground">
          Click en un color para aplicarlo en vivo. El cambio se guarda
          automáticamente.
        </p>
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
          {PALETA_COLORES_MARCA.map((opcion) => {
            const activo = opcion.hsl === colorActual;
            return (
              <SwatchButton
                key={opcion.id}
                nombre={opcion.nombre}
                hsl={opcion.hsl}
                activo={activo}
                disabled={!isAdmin || cualquierMutacionEnCurso}
                onClick={() => {
                  void handleElegirColor(opcion.hsl);
                }}
              />
            );
          })}
        </div>
      </section>

      {/* ── Preview ──────────────────────────────────────────────── */}
      <section className="space-y-2">
        <Label>Previa</Label>
        <PreviewBox />
      </section>

      {/* ── Logo ─────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <Label>Logo del club (opcional)</Label>
        <p className="text-xs text-muted-foreground">
          PNG o JPG, máx. 2 MB. Se muestra en el topbar junto al nombre.
        </p>
        <LogoSection
          clubId={club.id}
          logoPath={club.logo_path}
          nombreClub={club.nombre}
          isAdmin={isAdmin}
        />
      </section>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SwatchButton — círculo redondo con el color de la opción
// ─────────────────────────────────────────────────────────────────────

function SwatchButton({
  nombre,
  hsl,
  activo,
  disabled,
  onClick,
}: {
  nombre: string;
  hsl: string;
  activo: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={activo}
      aria-label={`Color ${nombre}${activo ? ' (actual)' : ''}`}
      title={nombre}
      className={cn(
        'group flex flex-col items-center gap-1.5',
        'focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      <span
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-full transition-all',
          'group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2',
          activo
            ? 'ring-2 ring-offset-2 ring-foreground'
            : 'ring-1 ring-border group-hover:ring-foreground/30 group-disabled:group-hover:ring-border',
        )}
        style={{ backgroundColor: `hsl(${hsl})` }}
      >
        {activo && (
          <Check
            className="h-5 w-5 text-white drop-shadow"
            aria-hidden="true"
          />
        )}
      </span>
      <span
        className={cn(
          'text-[10px] leading-tight text-center text-muted-foreground',
          activo && 'font-medium text-foreground',
        )}
      >
        {nombre}
      </span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// PreviewBox — mini-mockup que toma el color actual en vivo
// ─────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────
// LogoSection — preview + subir + quitar (con confirm inline)
// ─────────────────────────────────────────────────────────────────────

function LogoSection({
  clubId: _clubId,
  logoPath,
  nombreClub,
  isAdmin,
}: {
  // Recibido por simetría con futuras extensiones (ej. crop/resize).
  // No se usa directamente acá — el hook lee el clubId del SessionProvider.
  clubId: number;
  logoPath: string | null;
  nombreClub: string;
  isAdmin: boolean;
}) {
  const subirMutation = useSubirLogoClub();
  const quitarMutation = useQuitarLogoClub();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [confirmingQuitar, setConfirmingQuitar] = useState(false);

  const logoUrl = getLogoClubUrl(logoPath);
  const subiendo = subirMutation.isPending;
  const quitando = quitarMutation.isPending;
  const anyPending = subiendo || quitando;

  function abrirFilePicker(): void {
    setError(null);
    fileInputRef.current?.click();
  }

  async function handleFileChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.target.files?.[0];
    // Reset el input para que un segundo upload del mismo archivo
    // vuelva a disparar el change event.
    event.target.value = '';
    if (!file) return;
    setError(null);
    try {
      await subirMutation.mutateAsync({ file });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No pudimos subir el logo.',
      );
    }
  }

  async function handleConfirmarQuitar(): Promise<void> {
    setError(null);
    try {
      await quitarMutation.mutateAsync();
      setConfirmingQuitar(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No pudimos quitar el logo.',
      );
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3">
        {/* Preview o placeholder */}
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={`Logo de ${nombreClub}`}
            className="h-20 w-20 shrink-0 rounded border border-border bg-background object-contain p-1"
          />
        ) : (
          <div
            className="flex h-20 w-20 shrink-0 items-center justify-center rounded border border-dashed border-border bg-muted/30 text-muted-foreground"
            aria-label="Sin logo"
          >
            <ImageIcon className="h-7 w-7" aria-hidden="true" />
          </div>
        )}

        {/* Estado + acciones */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {subiendo
              ? 'Subiendo…'
              : logoUrl
                ? 'Logo activo. Lo ves en el topbar al lado del nombre del club.'
                : 'Sin logo subido. Por ahora se muestra solo el nombre del club.'}
          </p>

          {isAdmin && !confirmingQuitar && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={logoUrl ? 'outline' : 'default'}
                size="sm"
                onClick={abrirFilePicker}
                disabled={anyPending}
              >
                <Upload className="h-3.5 w-3.5" />
                {logoUrl ? 'Cambiar logo' : 'Subir logo'}
              </Button>
              {logoUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setError(null);
                    setConfirmingQuitar(true);
                  }}
                  disabled={anyPending}
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                  Quitar logo
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Input file oculto */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_LOGO_MIMES.join(',')}
          onChange={(e) => {
            void handleFileChange(e);
          }}
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
        />
      </div>

      {/* Confirmación inline para quitar */}
      {confirmingQuitar && (
        <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
              aria-hidden="true"
            />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                ¿Quitar el logo del club?
              </p>
              <p className="text-xs text-muted-foreground">
                El topbar va a volver a mostrar sólo el nombre. Podés
                subir uno nuevo cuando quieras.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmingQuitar(false)}
              disabled={quitando}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => {
                void handleConfirmarQuitar();
              }}
              disabled={quitando}
            >
              {quitando ? 'Quitando…' : 'Sí, quitar'}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}
    </div>
  );
}

function PreviewBox() {
  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button">Botón primario</Button>
        <span
          className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground"
          aria-hidden="true"
        >
          Estado activo
        </span>
        <a
          href="#preview"
          onClick={(e) => e.preventDefault()}
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Texto con enlace
        </a>
      </div>
      <Input
        type="text"
        placeholder="Foco en este input usa el color de marca"
        className="max-w-md text-sm"
        aria-label="Vista previa de input con focus ring"
      />
    </div>
  );
}
