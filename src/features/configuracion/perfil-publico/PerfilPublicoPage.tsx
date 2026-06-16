import { useState, useRef, type ChangeEvent, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, Trash2, Star, ExternalLink, ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/features/auth';

const FOTOS_BUCKET = 'fotos-clubes';

interface FotoRow {
  id: number;
  url: string;
  caption: string | null;
  orden: number;
  es_portada: boolean;
}

// ── Hooks internos ──────────────────────────────────────────────────────────

function useFotosClub(clubId: number | undefined) {
  return useQuery({
    queryKey: ['club-fotos-admin', clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('club_fotos')
        .select('id, url, caption, orden, es_portada')
        .order('orden');
      if (error) throw error;
      return (data ?? []) as FotoRow[];
    },
    enabled: !!clubId,
  });
}

// ── Página ──────────────────────────────────────────────────────────────────

export function PerfilPublicoPage() {
  const { club, user, updateClub } = useSession();
  const queryClient = useQueryClient();
  const isAdmin = user?.rol === 'admin';

  // Form local state (inicializado del club actual)
  const [descripcion, setDescripcion] = useState(club?.descripcion ?? '');
  const [instagram, setInstagram] = useState(club?.instagram ?? '');
  const [website, setWebsite] = useState(club?.website ?? '');
  const depositoCfg = (club?.config as any)?.deposito ?? {};
  const [depositoObligatorio, setDepositoObligatorio] = useState<boolean>(
    depositoCfg.obligatorio ?? false,
  );
  const [transferenciaAlias, setTransferenciaAlias] = useState<string>(
    depositoCfg.transferencia_alias ?? '',
  );
  const [depositoTipo, setDepositoTipo] = useState<'porcentaje' | 'fijo'>(
    depositoCfg.tipo ?? 'porcentaje',
  );
  const [depositoValor, setDepositoValor] = useState<string>(
    depositoCfg.valor?.toString() ?? '50',
  );
  const [coordsRaw, setCoordsRaw] = useState(
    club?.lat && club?.lng ? `${club.lat}, ${club.lng}` : '',
  );
  const [coordsError, setCoordsError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  function parseCoords(raw: string): { lat: number; lng: number } | null {
    // Normaliza guiones unicode (−, –, —) → hyphen estándar, elimina
    // caracteres invisibles que suelen venir del clipboard de Google Maps.
    const normalized = raw
      .replace(/[−–—―-]/g, '-')
      .replace(/[^\d.,-\s]/g, '')
      .trim();

    // Formato Google Maps: "-24.766, -65.458" (separado por coma)
    const byComma = normalized.split(',').map((s) => s.trim()).filter(Boolean);
    if (byComma.length >= 2) {
      const lat = parseFloat(byComma[0]!);
      const lng = parseFloat(byComma[1]!);
      if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return { lat, lng };
      }
    }

    // Fallback: separado por espacio "-24.766 -65.458"
    const bySpace = normalized.split(/\s+/).filter(Boolean);
    if (bySpace.length >= 2) {
      const lat = parseFloat(bySpace[0]!);
      const lng = parseFloat(bySpace[1]!);
      if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return { lat, lng };
      }
    }

    return null;
  }

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const fotosQuery = useFotosClub(club?.id);

  // ── Mutación: toggle perfil público ───────────────────────────────────────
  const togglePublico = useMutation({
    mutationFn: async (activo: boolean) => {
      const { error } = await supabase
        .from('clubes')
        .update({ perfil_publico_activo: activo })
        .eq('id', club!.id);
      if (error) throw error;
      return activo;
    },
    onSuccess: (activo) => {
      updateClub({ perfil_publico_activo: activo });
    },
  });

  // ── Mutación: guardar info del perfil ─────────────────────────────────────
  const guardarInfo = useMutation({
    mutationFn: async () => {
      const parsed = coordsRaw.trim() ? parseCoords(coordsRaw) : null;
      if (coordsRaw.trim() && !parsed) {
        throw new Error('Coordenadas inválidas. Pegá el formato de Google Maps: -34.603, -58.381');
      }
      const senaValorNum = Number(depositoValor) || 0;
      const patch: Record<string, unknown> = {
        descripcion: descripcion.trim() || null,
        instagram: instagram.trim().replace(/^@/, '') || null,
        website: website.trim() || null,
        lat: parsed?.lat ?? null,
        lng: parsed?.lng ?? null,
        // Mantener sena_porcentaje sincronizado en la columna correspondiente si es porcentaje
        sena_porcentaje: depositoTipo === 'porcentaje' ? Math.min(100, Math.max(10, Math.round(senaValorNum))) : (club?.sena_porcentaje ?? 50),
        // Guardar configuración personalizada en la columna `config`
        config: {
          ...(club?.config ?? {}),
          deposito: {
            obligatorio: depositoObligatorio,
            transferencia_alias: transferenciaAlias || null,
            tipo: depositoTipo,
            valor: senaValorNum,
          },
        },
      };
      const { error } = await supabase
        .from('clubes')
        .update(patch)
        .eq('id', club!.id);
      if (error) throw error;
      return patch;
    },
    onSuccess: (patch) => {
      setSaveError(null);
      setCoordsError(null);
      updateClub(patch as Parameters<typeof updateClub>[0]);
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Error al guardar';
      if (msg.includes('Coordenadas')) setCoordsError(msg);
      else setSaveError(msg);
    },
  });

  // ── Upload de foto ─────────────────────────────────────────────────────────
  async function handleFotoUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !club) return;
    setUploadError(null);
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() ?? 'jpg';
      const path = `${club.id}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from(FOTOS_BUCKET)
        .upload(path, file);
      if (uploadErr) throw uploadErr;

      const { data: { publicUrl } } = supabase.storage
        .from(FOTOS_BUCKET)
        .getPublicUrl(path);

      const esPrimera = (fotosQuery.data?.length ?? 0) === 0;
      const { error: insertErr } = await supabase.from('club_fotos').insert({
        club_id: club.id,
        url: publicUrl,
        orden: fotosQuery.data?.length ?? 0,
        es_portada: esPrimera,
      });
      if (insertErr) throw insertErr;

      await queryClient.invalidateQueries({
        queryKey: ['club-fotos-admin', club.id],
      });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Error al subir la foto');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  // ── Eliminar foto ─────────────────────────────────────────────────────────
  async function handleDeleteFoto(foto: FotoRow) {
    if (!club) return;
    await supabase.from('club_fotos').delete().eq('id', foto.id);
    // Best-effort: borrar del storage
    const storagePath = foto.url.split(`/${FOTOS_BUCKET}/`)[1];
    if (storagePath) {
      await supabase.storage.from(FOTOS_BUCKET).remove([storagePath]);
    }
    await queryClient.invalidateQueries({
      queryKey: ['club-fotos-admin', club.id],
    });
  }

  // ── Marcar como portada ───────────────────────────────────────────────────
  async function handleSetPortada(foto: FotoRow) {
    if (!club) return;
    // Quita portada a todas, pone en la elegida (two updates pero sin RPC)
    await supabase
      .from('club_fotos')
      .update({ es_portada: false })
      .eq('club_id', club.id);
    await supabase
      .from('club_fotos')
      .update({ es_portada: true })
      .eq('id', foto.id);
    await queryClient.invalidateQueries({
      queryKey: ['club-fotos-admin', club.id],
    });
  }

  // ── Submit formulario ─────────────────────────────────────────────────────
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    guardarInfo.mutate();
  }

  if (!club) {
    return (
      <p className="text-sm text-muted-foreground">Cargando datos del club…</p>
    );
  }

  const perfilActivo = club.perfil_publico_activo ?? false;
  const perfilUrl = `/club/${club.slug}`;

  return (
    <div className="space-y-8">
      {/* ── Toggle perfil público ── */}
      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="font-semibold">Perfil público</h2>
            <p className="text-sm text-muted-foreground">
              Cuando está activo, tu club aparece en el marketplace de MatchGo
              y jugadores pueden encontrarte en{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                matchgo.app{perfilUrl}
              </code>
            </p>
          </div>
          <Button
            type="button"
            variant={perfilActivo ? 'default' : 'outline'}
            size="sm"
            disabled={!isAdmin || togglePublico.isPending}
            onClick={() => togglePublico.mutate(!perfilActivo)}
          >
            {togglePublico.isPending
              ? 'Guardando…'
              : perfilActivo
                ? 'Activo'
                : 'Inactivo'}
          </Button>
        </div>
        {perfilActivo && (
          <a
            href={perfilUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            Ver mi perfil público
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </section>

      {/* ── Información del perfil ── */}
      <form onSubmit={handleSubmit} className="space-y-6">
        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-4 font-semibold">Información del perfil</h2>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="descripcion">Descripción del club</Label>
              <textarea
                id="descripcion"
                rows={4}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Contanos quiénes son, qué ofrecen, qué hace especial a tu club…"
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                disabled={!isAdmin}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="instagram">Instagram (sin @)</Label>
                <Input
                  id="instagram"
                  placeholder="clubpadelnorte"
                  value={instagram}
                  onChange={(e) => setInstagram(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="website">Sitio web</Label>
                <Input
                  id="website"
                  type="url"
                  placeholder="https://mipagina.com.ar"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  disabled={!isAdmin}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="coords">Ubicación en el mapa</Label>
              <p className="text-xs text-muted-foreground">
                Abrí{' '}
                <a
                  href="https://maps.google.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                >
                  Google Maps
                </a>
                , buscá tu club, hacé click derecho sobre el punto exacto y
                seleccioná la primera opción (las coordenadas). Copiá y pegá acá.
              </p>
              <Input
                id="coords"
                placeholder="-24.7663, -65.4588"
                value={coordsRaw}
                onChange={(e) => {
                  setCoordsRaw(e.target.value);
                  setCoordsError(null);
                }}
                disabled={!isAdmin}
                className={coordsError ? 'border-destructive' : ''}
              />
              {coordsError && (
                <p className="text-xs text-destructive">{coordsError}</p>
              )}
              {coordsRaw.trim() && parseCoords(coordsRaw) && (
                <p className="text-xs text-muted-foreground">
                  ✓ Lat {parseCoords(coordsRaw)!.lat.toFixed(5)} · Lng{' '}
                  {parseCoords(coordsRaw)!.lng.toFixed(5)}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* ── Configuración de depósito / seña ── */}
        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-4 font-semibold">Depósito / Seña</h2>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <input
                id="deposito-obligatorio"
                type="checkbox"
                checked={depositoObligatorio}
                onChange={(e) => setDepositoObligatorio(e.target.checked)}
                disabled={!isAdmin}
                className="h-4 w-4"
              />
              <Label htmlFor="deposito-obligatorio">Obligar pago de seña al reservar</Label>
            </div>

            {depositoObligatorio && (
              <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Tipo de seña</Label>
                  <div className="flex gap-4 mt-1">
                    <label className="flex items-center gap-2 text-sm font-normal cursor-pointer">
                      <input
                        type="radio"
                        name="deposito-tipo"
                        value="porcentaje"
                        checked={depositoTipo === 'porcentaje'}
                        onChange={() => setDepositoTipo('porcentaje')}
                        disabled={!isAdmin}
                        className="h-4 w-4"
                      />
                      Porcentaje del total (%)
                    </label>
                    <label className="flex items-center gap-2 text-sm font-normal cursor-pointer">
                      <input
                        type="radio"
                        name="deposito-tipo"
                        value="fijo"
                        checked={depositoTipo === 'fijo'}
                        onChange={() => setDepositoTipo('fijo')}
                        disabled={!isAdmin}
                        className="h-4 w-4"
                      />
                      Monto fijo ($)
                    </label>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="deposito-valor">
                    {depositoTipo === 'porcentaje' ? 'Porcentaje de la seña (10-100%)' : 'Monto de la seña ($)'}
                  </Label>
                  <Input
                    id="deposito-valor"
                    type="number"
                    min={depositoTipo === 'porcentaje' ? 10 : 0}
                    max={depositoTipo === 'porcentaje' ? 100 : undefined}
                    value={depositoValor}
                    onChange={(e) => setDepositoValor(e.target.value)}
                    disabled={!isAdmin}
                    placeholder={depositoTipo === 'porcentaje' ? '50' : '3000'}
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="transferencia-alias">Alias / CBU para transferencias</Label>
              <Input
                id="transferencia-alias"
                value={transferenciaAlias}
                onChange={(e) => setTransferenciaAlias(e.target.value)}
                disabled={!isAdmin}
                placeholder="Alias o CBU del club (p.ej. alias@banco)"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Por ahora, el pago de la seña se hace por transferencia usando el alias del club.
            </p>
          </div>
        </section>

        {saveError && (
          <p className="text-sm text-destructive">{saveError}</p>
        )}

        {isAdmin && (
          <div className="flex justify-end">
            <Button type="submit" disabled={guardarInfo.isPending}>
              {guardarInfo.isPending ? 'Guardando…' : 'Guardar información'}
            </Button>
          </div>
        )}
      </form>

      {/* ── Fotos ── */}
      {isAdmin && (
        <section className="space-y-4 rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Fotos del club</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                La foto marcada con ★ aparece como imagen principal del perfil.
              </p>
            </div>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleFotoUpload}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="mr-1.5 h-4 w-4" />
                {uploading ? 'Subiendo…' : 'Subir foto'}
              </Button>
            </div>
          </div>

          {uploadError && (
            <p className="text-sm text-destructive">{uploadError}</p>
          )}

          {fotosQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando fotos…</p>
          ) : fotosQuery.data?.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-10 text-center">
              <ImageIcon className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                No hay fotos todavía. Subí la primera para mejorar tu perfil.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {fotosQuery.data?.map((foto) => (
                <div
                  key={foto.id}
                  className="group relative aspect-video overflow-hidden rounded-lg bg-muted"
                >
                  <img
                    src={foto.url}
                    alt={foto.caption ?? ''}
                    className="h-full w-full object-cover"
                  />
                  {foto.es_portada && (
                    <div className="absolute left-1.5 top-1.5 rounded-full bg-black/60 p-1">
                      <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                    </div>
                  )}
                  {/* Controles al hover */}
                  <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                    {!foto.es_portada && (
                      <button
                        type="button"
                        title="Usar como portada"
                        onClick={() => handleSetPortada(foto)}
                        className="rounded-full bg-white/20 p-1.5 text-white backdrop-blur-sm hover:bg-white/30"
                      >
                        <Star className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      title="Eliminar foto"
                      onClick={() => handleDeleteFoto(foto)}
                      className="rounded-full bg-white/20 p-1.5 text-white backdrop-blur-sm hover:bg-red-500/60"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
