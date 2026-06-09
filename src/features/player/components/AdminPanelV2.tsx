import { useState, useRef } from 'react';
import { useAdminPanelV2 } from '../hooks/useAdminPanelV2';

interface AdminPanelV2Props {
  clubId: number;
  clubNombre: string;
  onPostCreated?: () => void;
}

const DURACIONES = [
  { label: '24 horas', valor: 24 },
  { label: '48 horas', valor: 48 },
  { label: '72 horas (3 días)', valor: 72 },
];

const BADGES = [
  { label: '🔥 URGENTE', valor: 'URGENTE 🔥' },
  { label: '⏰ LIMITED TIME', valor: 'LIMITED 24h' },
  { label: '🎁 OFERTA', valor: 'OFERTA ESPECIAL' },
  { label: 'Ninguno', valor: null },
];

const TIPOS_CTA = [
  { label: '→ Reservar ahora', valor: '/player/reservar' },
  { label: '→ Ver detalles', valor: '/player' },
  { label: '→ Inscribirse', valor: '#inscribirse' },
  { label: 'Ninguno', valor: null },
];

export function AdminPanelV2({ clubId, clubNombre, onPostCreated }: AdminPanelV2Props) {
  const { isLoading, error, subirImagen, crearPost } = useAdminPanelV2();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State del formulario
  const [postForm, setPostForm] = useState({
    titulo: '',
    contenido: '',
    tipo: 'promo' as const,
    badge: null as string | null,
    cta_texto: 'Reservar ahora',
    cta_link: null as string | null,
    duracion_horas: 24,
  });

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [success, setSuccess] = useState(false);

  // ─────────────────────────────────────────────────────────────────

  function handleSelectImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validar
    if (file.size > 5 * 1024 * 1024) {
      alert('Imagen muy grande (máximo 5MB)');
      return;
    }

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      alert('Solo JPG, PNG o WebP');
      return;
    }

    setImageFile(file);

    // Preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setImagePreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  }

  async function handleCrearPost(e: React.FormEvent) {
    e.preventDefault();

    if (!postForm.titulo || !postForm.contenido) {
      alert('Título y contenido son requeridos');
      return;
    }

    try {
      let imageUrl: string | undefined;

      // Subir imagen si seleccionó
      if (imageFile) {
        setUploadingImage(true);
        imageUrl = await subirImagen(imageFile, clubId);
      }

      // Crear post
      await crearPost(clubId, {
        ...postForm,
        imagen_url: imageUrl,
      });

      // Reset
      setPostForm({
        titulo: '',
        contenido: '',
        tipo: 'promo',
        badge: null,
        cta_texto: 'Reservar ahora',
        cta_link: null,
        duracion_horas: 24,
      });
      setImageFile(null);
      setImagePreview(null);
      setSuccess(true);

      setTimeout(() => setSuccess(false), 3000);
      onPostCreated?.();
    } catch (err) {
      console.error('Error al crear post:', err);
    } finally {
      setUploadingImage(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────

  return (
    <div className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-cyan-50 p-6">
      {/* Header */}
      <div className="mb-6 rounded-lg bg-gradient-to-r from-blue-500 to-cyan-500 px-4 py-3">
        <p className="text-xs font-bold text-white uppercase tracking-widest">
          📱 CREAR NOTICIA / PROMO
        </p>
        <p className="text-sm font-bold text-white">{clubNombre}</p>
        <p className="text-xs text-blue-100 mt-1">Posts que expiran automáticamente</p>
      </div>

      <form onSubmit={handleCrearPost} className="space-y-4">
        {/* Tipo de contenido */}
        <div>
          <label className="block text-xs font-bold text-gray-700 mb-2">
            📌 Tipo de contenido
          </label>
          <select
            value={postForm.tipo}
            onChange={(e) =>
              setPostForm({ ...postForm, tipo: e.target.value as any })
            }
            className="w-full rounded-lg border-2 border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="noticia">📰 Noticia</option>
            <option value="promo">🎉 Promoción</option>
            <option value="torneo">🏆 Torneo</option>
            <option value="otro">📌 Otro</option>
          </select>
        </div>

        {/* Título */}
        <div>
          <label className="block text-xs font-bold text-gray-700 mb-2">
            ✏️ Título (importante - primera línea)
          </label>
          <input
            type="text"
            value={postForm.titulo}
            onChange={(e) => setPostForm({ ...postForm, titulo: e.target.value })}
            placeholder="Ej: 50% OFF MAÑANA 10-12hs 🔥"
            maxLength={80}
            className="w-full rounded-lg border-2 border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          <p className="text-xs text-gray-400 mt-1">
            {postForm.titulo.length}/80 caracteres
          </p>
        </div>

        {/* Contenido */}
        <div>
          <label className="block text-xs font-bold text-gray-700 mb-2">
            📝 Descripción/Detalles
          </label>
          <textarea
            value={postForm.contenido}
            onChange={(e) => setPostForm({ ...postForm, contenido: e.target.value })}
            placeholder="Ej: Reserva ahora, quedan solo 6 turnos disponibles..."
            maxLength={200}
            rows={3}
            className="w-full rounded-lg border-2 border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          <p className="text-xs text-gray-400 mt-1">
            {postForm.contenido.length}/200 caracteres
          </p>
        </div>

        {/* Imagen */}
        <div>
          <label className="block text-xs font-bold text-gray-700 mb-2">
            🖼️ Imagen (JPG/PNG, máx 5MB)
          </label>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full rounded-lg border-2 border-dashed border-gray-300 px-4 py-3 text-center hover:border-blue-500 hover:bg-blue-50 transition"
          >
            <p className="text-sm font-bold text-gray-600">
              {imageFile ? '✓ Imagen seleccionada' : '📸 Click para subir imagen'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {imageFile ? imageFile.name : 'JPG, PNG, WebP'}
            </p>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleSelectImage}
            className="hidden"
          />

          {/* Preview */}
          {imagePreview && (
            <div className="mt-3 rounded-lg overflow-hidden border-2 border-gray-200">
              <img
                src={imagePreview}
                alt="Preview"
                className="w-full h-auto max-h-48 object-cover"
              />
            </div>
          )}
        </div>

        {/* Badge / Urgencia */}
        <div>
          <label className="block text-xs font-bold text-gray-700 mb-2">
            🚨 Urgencia / Badge
          </label>
          <select
            value={postForm.badge || ''}
            onChange={(e) =>
              setPostForm({ ...postForm, badge: e.target.value || null })
            }
            className="w-full rounded-lg border-2 border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            {BADGES.map((b) => (
              <option key={b.label} value={b.valor || ''}>
                {b.label}
              </option>
            ))}
          </select>
        </div>

        {/* CTA */}
        <div>
          <label className="block text-xs font-bold text-gray-700 mb-2">
            🎯 Botón de Acción
          </label>
          <select
            value={postForm.cta_link || ''}
            onChange={(e) =>
              setPostForm({
                ...postForm,
                cta_link: e.target.value || null,
                cta_texto: TIPOS_CTA.find((t) => t.valor === e.target.value)?.label.slice(2) || 'Reservar',
              })
            }
            className="w-full rounded-lg border-2 border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            {TIPOS_CTA.map((t) => (
              <option key={t.label} value={t.valor || ''}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {/* Duración */}
        <div>
          <label className="block text-xs font-bold text-gray-700 mb-2">
            ⏱️ ¿Cuánto tiempo está visible?
          </label>
          <div className="grid grid-cols-3 gap-2">
            {DURACIONES.map((d) => (
              <button
                key={d.valor}
                type="button"
                onClick={() => setPostForm({ ...postForm, duracion_horas: d.valor })}
                className={`rounded-lg px-3 py-2 text-xs font-bold transition ${
                  postForm.duracion_horas === d.valor
                    ? 'bg-blue-500 text-white border-2 border-blue-500'
                    : 'border-2 border-gray-300 text-gray-700 hover:border-blue-300'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* Errores y Success */}
        {error && (
          <div className="rounded-lg bg-red-100 px-3 py-2 border-l-4 border-red-500">
            <p className="text-xs font-bold text-red-700">❌ {error}</p>
          </div>
        )}

        {success && (
          <div className="rounded-lg bg-green-100 px-3 py-2 border-l-4 border-green-500">
            <p className="text-xs font-bold text-green-700">✅ Post creado correctamente</p>
          </div>
        )}

        {/* Botón Submit */}
        <button
          type="submit"
          disabled={
            isLoading ||
            uploadingImage ||
            !postForm.titulo ||
            !postForm.contenido
          }
          className="w-full rounded-lg bg-gradient-to-r from-blue-500 to-cyan-500 px-4 py-3 font-bold text-white hover:shadow-lg disabled:opacity-60 transition"
        >
          {isLoading || uploadingImage ? '⏳ Publicando...' : '🚀 Publicar Noticia'}
        </button>

        {/* Info */}
        <div className="rounded-lg bg-blue-50 px-3 py-2 border-l-4 border-blue-300 text-xs text-gray-600">
          <p className="font-bold mb-1">💡 Consejos:</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Usa títulos cortos y urgentes ("50% OFF", "SOLO HOY")</li>
            <li>Sube imágenes atractivas (1080x1350 es ideal)</li>
            <li>Agrega badge 🔥 para promos urgentes</li>
            <li>Los posts expiran automáticamente</li>
          </ul>
        </div>
      </form>
    </div>
  );
}
