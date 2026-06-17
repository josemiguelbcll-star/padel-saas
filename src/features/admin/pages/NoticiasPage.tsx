import { useState, useRef } from 'react';
import { Trash2, Upload, Pencil, X, Newspaper } from 'lucide-react';
import { useSession } from '@/features/auth';
import { getPermiso } from '@/lib/permisos';
import { 
  useNoticiasClub, 
  useCrearNoticia, 
  useEliminarNoticia, 
  useEditarNoticia, 
  type NoticiaFeed 
} from '../hooks/useNoticiasClub';

export function NoticiasPage() {
  const { user } = useSession();
  const clubId = user?.club_id;
  const canEdit = getPermiso(user, 'noticias', 'editar');

  if (!clubId) {
    return (
      <div className="flex items-center justify-center min-h-[300px] text-muted-foreground text-sm">
        Cargando datos del club...
      </div>
    );
  }

  const clubIdNum = clubId;
  const { data: noticias, isLoading, refetch } = useNoticiasClub(clubIdNum);
  const { createNoticia, subirImagen } = useCrearNoticia();
  const { editNoticia } = useEditarNoticia();
  const eliminarNoticia = useEliminarNoticia();

  const fileInputRef = useRef<HTMLInputElement>(null);

  // State del formulario
  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [editingNoticia, setEditingNoticia] = useState<NoticiaFeed | null>(null);

  // Estado UI
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSelectImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setError('La imagen es muy grande (máximo 10MB)');
      return;
    }

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Solo se permiten formatos JPG, PNG o WebP');
      return;
    }

    setImageFile(file);
    setError(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      setImagePreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  }

  function handleRemoveImage() {
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  function handleStartEdit(noticia: NoticiaFeed) {
    setEditingNoticia(noticia);
    setTitulo(noticia.titulo);
    setDescripcion(noticia.descripcion || '');
    setImagePreview(noticia.imagen_url);
    setImageFile(null);
    setError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleCancelEdit() {
    setEditingNoticia(null);
    setTitulo('');
    setDescripcion('');
    setImagePreview(null);
    setImageFile(null);
    setError(null);
  }

  async function handlePublicar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!titulo.trim()) {
      setError('El título es requerido');
      return;
    }

    try {
      setIsSubmitting(true);
      let imagenUrl: string | null = null;

      if (imagePreview) {
        if (imageFile) {
          setUploadingImage(true);
          imagenUrl = await subirImagen(imageFile, clubIdNum);
        } else {
          // Si no hay archivo nuevo pero la preview tiene contenido, mantenemos la imagen existente
          imagenUrl = editingNoticia?.imagen_url || null;
        }
      } else {
        // Si no hay preview, eliminamos la imagen
        imagenUrl = null;
      }

      if (editingNoticia) {
        await editNoticia(editingNoticia.id, titulo.trim(), descripcion.trim(), imagenUrl);
        setEditingNoticia(null);
      } else {
        await createNoticia(clubIdNum, titulo.trim(), descripcion.trim(), imagenUrl || undefined);
      }

      // Reset form
      setTitulo('');
      setDescripcion('');
      setImageFile(null);
      setImagePreview(null);
      setSuccess(true);

      setTimeout(() => setSuccess(false), 3000);
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar la noticia');
    } finally {
      setIsSubmitting(false);
      setUploadingImage(false);
    }
  }

  async function handleEliminar(noticiaId: number) {
    if (!confirm('¿Estás seguro de que deseas eliminar esta noticia?')) return;

    try {
      await eliminarNoticia(noticiaId);
      // Si estábamos editando la noticia eliminada, cancelamos la edición
      if (editingNoticia?.id === noticiaId) {
        handleCancelEdit();
      }
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar');
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-2 pb-4 border-b border-border">
        <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-[#0B1F4D] flex items-center gap-2">
          <Newspaper className="h-7 w-7 text-primary" />
          Feed de Noticias
        </h1>
        <p className="text-sm text-muted-foreground">
          Publicá y gestioná noticias, promociones y avisos para que los jugadores los vean en su feed principal.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* ── SECCIÓN DE FORMULARIO (CREAR O EDITAR) ── */}
        {canEdit && (
          <div className="lg:col-span-5 bg-card rounded-2xl border border-border p-5 md:p-6 shadow-sm space-y-6">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h2 className="text-lg font-bold text-[#0B1F4D]">
                {editingNoticia ? '📝 Editar noticia' : '➕ Crear noticia'}
              </h2>
              {editingNoticia && (
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  <X size={14} /> Cancelar edición
                </button>
              )}
            </div>

            <form onSubmit={handlePublicar} className="space-y-5">
              {/* Carga de Imagen */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                  Imagen de la noticia
                </label>
                <div className="flex flex-col gap-3">
                  {imagePreview ? (
                    <div className="relative rounded-xl overflow-hidden border border-border bg-muted aspect-[4/5] max-h-[280px] w-full flex items-center justify-center">
                      <img 
                        src={imagePreview} 
                        alt="Vista previa" 
                        className="w-full h-full object-cover" 
                      />
                      <button
                        type="button"
                        onClick={handleRemoveImage}
                        className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white rounded-full p-1.5 transition shadow"
                        title="Eliminar imagen"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full py-8 border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 rounded-xl bg-muted/40 hover:bg-muted/60 transition flex flex-col items-center justify-center gap-2 group text-muted-foreground hover:text-foreground"
                    >
                      <Upload size={24} className="group-hover:scale-110 transition duration-200 text-muted-foreground/75" />
                      <span className="text-xs font-semibold">Subir imagen promocional</span>
                      <span className="text-[10px] text-muted-foreground/60">Sugerido: Formato vertical 4:5</span>
                    </button>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleSelectImage}
                    className="hidden"
                  />
                </div>
              </div>

              {/* Título */}
              <div className="space-y-1">
                <label htmlFor="title-input" className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                  Título (máx 120 caracteres)
                </label>
                <input
                  id="title-input"
                  type="text"
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  placeholder="Ej: ¡Este finde abrimos nueva cancha!"
                  maxLength={120}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  required
                />
                <div className="text-[10px] text-right text-muted-foreground">
                  {titulo.length}/120
                </div>
              </div>

              {/* Descripción */}
              <div className="space-y-1">
                <label htmlFor="description-input" className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                  Descripción (opcional, máx 300 caracteres)
                </label>
                <textarea
                  id="description-input"
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  placeholder="Describí los detalles de la noticia..."
                  maxLength={300}
                  rows={4}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                />
                <div className="text-[10px] text-right text-muted-foreground">
                  {descripcion.length}/300
                </div>
              </div>

              {error && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-xs text-destructive">
                  ⚠️ {error}
                </div>
              )}

              {success && (
                <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-xs text-green-600">
                  {editingNoticia ? '✓ Noticia editada con éxito' : '✓ Noticia publicada con éxito'}
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={isSubmitting || uploadingImage || !titulo.trim()}
                className="w-full py-2.5 px-4 bg-primary hover:bg-primary/95 text-primary-foreground font-bold rounded-lg text-sm transition disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                {isSubmitting || uploadingImage 
                  ? '⏳ Guardando...' 
                  : editingNoticia 
                    ? 'Actualizar noticia' 
                    : 'Publicar noticia'
                }
              </button>
            </form>
          </div>
        )}

        {/* ── SECCIÓN DE LISTADO DE NOTICIAS PUBLICADAS ── */}
        <div className={canEdit ? 'lg:col-span-7 space-y-4' : 'lg:col-span-12 space-y-4'}>
          <h2 className="text-lg font-bold text-[#0B1F4D]">
            📌 Noticias publicadas ({noticias?.length || 0})
          </h2>

          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 border border-border rounded-2xl bg-card">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent mb-2" />
              <p className="text-sm text-muted-foreground">Cargando feed...</p>
            </div>
          ) : noticias && noticias.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4">
              {noticias.map((noticia) => (
                <div
                  key={noticia.id}
                  className="bg-card border border-border rounded-xl p-4 flex flex-col sm:flex-row gap-4 items-start hover:shadow-sm transition"
                >
                  {/* Thumbnail */}
                  {noticia.imagen_url ? (
                    <div className="w-full sm:w-20 h-40 sm:h-20 rounded-lg overflow-hidden flex-shrink-0 bg-muted border border-border">
                      <img 
                        src={noticia.imagen_url} 
                        alt={noticia.titulo} 
                        className="w-full h-full object-cover" 
                      />
                    </div>
                  ) : (
                    <div className="w-full sm:w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 bg-muted border border-border flex items-center justify-center text-muted-foreground/30">
                      <Newspaper size={28} />
                    </div>
                  )}

                  {/* Info */}
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-bold text-[#0B1F4D] text-sm line-clamp-2">
                        {noticia.titulo}
                      </h3>
                    </div>
                    {noticia.descripcion && (
                      <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
                        {noticia.descripcion}
                      </p>
                    )}
                    <span className="text-[10px] text-muted-foreground/75 block pt-1">
                      {new Date(noticia.creado_en).toLocaleDateString('es-AR', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric'
                      })}
                    </span>
                  </div>

                  {/* Acciones */}
                  {canEdit && (
                    <div className="flex sm:flex-col gap-2 w-full sm:w-auto pt-3 sm:pt-0 border-t sm:border-t-0 border-border flex-shrink-0 justify-end">
                      <button
                        onClick={() => handleStartEdit(noticia)}
                        className="flex-1 sm:flex-none p-2 bg-muted hover:bg-muted/80 hover:text-primary rounded-lg transition text-muted-foreground flex items-center justify-center gap-1.5 text-xs font-semibold"
                        title="Editar"
                      >
                        <Pencil size={15} />
                        <span className="sm:hidden">Editar</span>
                      </button>
                      <button
                        onClick={() => handleEliminar(noticia.id)}
                        className="flex-1 sm:flex-none p-2 bg-destructive/10 hover:bg-destructive/20 hover:text-destructive rounded-lg transition text-destructive flex items-center justify-center gap-1.5 text-xs font-semibold"
                        title="Eliminar"
                      >
                        <Trash2 size={15} />
                        <span className="sm:hidden">Eliminar</span>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 border-2 border-dashed border-border rounded-2xl bg-muted/20 text-muted-foreground flex flex-col items-center justify-center gap-2">
              <Newspaper size={36} className="text-muted-foreground/40" />
              <p className="text-sm font-semibold">No hay noticias publicadas</p>
              <p className="text-xs text-muted-foreground/70">Comenzá cargando tu primera noticia promocional.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
