import { useState, useRef } from 'react';
import { Trash2, Upload } from 'lucide-react';
import { useSession } from '@/features/auth';
import { getPermiso } from '@/lib/permisos';
import { useNoticiasClub, useCrearNoticia, useEliminarNoticia } from '../hooks/useNoticiasClub';

export function NoticiasPage() {
  const { user } = useSession();
  const clubId = user?.club_id;
  const canEdit = getPermiso(user, 'noticias', 'editar');

  if (!clubId) {
    return <div style={{ padding: '24px', textAlign: 'center' }}>Cargando...</div>;
  }
  const clubIdNum = clubId;
  const { data: noticias, isLoading, refetch } = useNoticiasClub(clubIdNum);
  const { createNoticia, subirImagen } = useCrearNoticia();
  const eliminarNoticia = useEliminarNoticia();

  const fileInputRef = useRef<HTMLInputElement>(null);

  // State del formulario
  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  // Estado UI
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─────────────────────────────────────────────────────────────────

  function handleSelectImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setError('Imagen muy grande (máximo 10MB)');
      return;
    }

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Solo JPG, PNG o WebP');
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

  async function handlePublicar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!titulo.trim()) {
      setError('El título es requerido');
      return;
    }

    try {
      setIsSubmitting(true);

      let imagenUrl: string | undefined;

      // Subir imagen si seleccionó
      if (imageFile) {
        setUploadingImage(true);
        imagenUrl = await subirImagen(imageFile, clubIdNum);
      }

      // Crear noticia
      await createNoticia(clubIdNum, titulo, descripcion, imagenUrl);

      // Reset
      setTitulo('');
      setDescripcion('');
      setImageFile(null);
      setImagePreview(null);
      setSuccess(true);

      setTimeout(() => setSuccess(false), 3000);
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al publicar');
    } finally {
      setIsSubmitting(false);
      setUploadingImage(false);
    }
  }

  async function handleEliminar(noticiaId: number) {
    if (!confirm('¿Eliminar esta noticia?')) return;

    try {
      await eliminarNoticia(noticiaId);
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar');
    }
  }

  // ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '24px' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 'bold', color: '#0B1F4D', margin: 0 }}>
          📱 Noticias del Feed
        </h1>
        <p style={{ fontSize: '14px', color: '#64748B', margin: '8px 0 0' }}>
          Carga noticias que verán todos los jugadores en la app
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: canEdit ? '1fr 1fr' : '1fr', gap: '32px' }}>
        {/* ── CREAR NOTICIA ── */}
        {canEdit && (
          <div
            style={{
              background: '#fff',
              border: '1.5px solid #E2E8F0',
              borderRadius: '16px',
              padding: '24px',
            }}
          >
            <h2 style={{ fontSize: '16px', fontWeight: 'bold', color: '#0B1F4D', marginTop: 0 }}>
              ➕ Crear noticia
            </h2>

            <form onSubmit={handlePublicar} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Imagen */}
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', color: '#475569', marginBottom: '8px' }}>
                  📸 Imagen
                </label>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    width: '100%',
                    padding: '16px',
                    border: '2px dashed #CBD5E1',
                    borderRadius: '12px',
                    background: '#F8FAFC',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#0B1F4D')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#CBD5E1')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: '#64748B' }}>
                    <Upload size={18} />
                    <span style={{ fontSize: '13px', fontWeight: '500' }}>
                      {imageFile ? '✓ Imagen seleccionada' : 'Click para subir'}
                    </span>
                  </div>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleSelectImage}
                  style={{ display: 'none' }}
                />

                {imagePreview && (
                  <div style={{ marginTop: '12px', borderRadius: '12px', overflow: 'hidden', border: '1px solid #E2E8F0', aspectRatio: '4/5', background: '#F1F5F9' }}>
                    <img src={imagePreview} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                )}
              </div>

              {/* Título */}
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', color: '#475569', marginBottom: '6px' }}>
                  📝 Título (máx 120 caracteres)
                </label>
                <input
                  type="text"
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  placeholder="Ej: Oferta especial del mes"
                  maxLength={120}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1.5px solid #E2E8F0',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontFamily: 'inherit',
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '4px' }}>
                  {titulo.length}/120
                </div>
              </div>

              {/* Descripción */}
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', color: '#475569', marginBottom: '6px' }}>
                  💬 Descripción (opcional)
                </label>
                <textarea
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  placeholder="Cuéntale a los jugadores de qué se trata esta noticia..."
                  maxLength={300}
                  rows={4}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1.5px solid #E2E8F0',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontFamily: 'inherit',
                    boxSizing: 'border-box',
                    resize: 'vertical',
                  }}
                />
                <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '4px' }}>
                  {descripcion.length}/300
                </div>
              </div>

              {/* Errores */}
              {error && (
                <div style={{ padding: '12px', background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: '8px', fontSize: '12px', color: '#DC2626' }}>
                  ❌ {error}
                </div>
              )}

              {/* Success */}
              {success && (
                <div style={{ padding: '12px', background: '#DCFCE7', border: '1px solid #BBF7D0', borderRadius: '8px', fontSize: '12px', color: '#166534' }}>
                  ✅ Noticia publicada correctamente
                </div>
              )}

              {/* Botón Submit */}
              <button
                type="submit"
                disabled={isSubmitting || uploadingImage || !titulo.trim()}
                style={{
                  padding: '12px',
                  background: '#0B5BE5',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 'bold',
                  fontSize: '14px',
                  cursor: isSubmitting || uploadingImage ? 'not-allowed' : 'pointer',
                  opacity: isSubmitting || uploadingImage || !titulo.trim() ? 0.6 : 1,
                  transition: 'opacity 0.2s',
                }}
              >
                {isSubmitting || uploadingImage ? '⏳ Publicando...' : '🚀 Publicar noticia'}
              </button>
            </form>
          </div>
        )}

        {/* ── NOTICIAS PUBLICADAS ── */}
        <div>
          <h2 style={{ fontSize: '16px', fontWeight: 'bold', color: '#0B1F4D', marginTop: 0, marginBottom: '16px' }}>
            📌 Noticias publicadas ({noticias?.length || 0})
          </h2>

          {isLoading ? (
            <div style={{ textAlign: 'center', padding: '32px', color: '#94A3B8' }}>Cargando...</div>
          ) : noticias && noticias.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {noticias.map((noticia) => (
                <div
                  key={noticia.id}
                  style={{
                    background: '#fff',
                    border: '1.5px solid #E2E8F0',
                    borderRadius: '12px',
                    padding: '16px',
                    display: 'flex',
                    gap: '12px',
                  }}
                >
                  {/* Imagen thumbnail */}
                  {noticia.imagen_url && (
                    <div style={{ width: '60px', height: '60px', borderRadius: '8px', overflow: 'hidden', flexShrink: 0, background: '#F1F5F9' }}>
                      <img src={noticia.imagen_url} alt={noticia.titulo} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                  )}

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '13px', fontWeight: 'bold', color: '#0B1F4D', margin: '0 0 4px' }}>
                      {noticia.titulo}
                    </p>
                    <p style={{ fontSize: '12px', color: '#64748B', margin: '0 0 6px', lineHeight: '1.4' }}>
                      {noticia.descripcion}
                    </p>
                    <p style={{ fontSize: '11px', color: '#94A3B8', margin: 0 }}>
                      {new Date(noticia.creado_en).toLocaleDateString('es-AR')}
                    </p>
                  </div>

                  {/* Botón eliminar */}
                  {canEdit && (
                    <button
                      onClick={() => handleEliminar(noticia.id)}
                      style={{
                        padding: '8px',
                        background: '#FEE2E2',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        color: '#DC2626',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                      title="Eliminar"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: '32px', textAlign: 'center', color: '#94A3B8', background: '#F8FAFC', borderRadius: '12px' }}>
              No hay noticias publicadas aún
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
