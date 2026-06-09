import { useState } from 'react';
import { useAdminPanel } from '../hooks/useAdminPanel';

interface AdminPanelProps {
  clubId: number;
  clubNombre: string;
  tarifas?: Array<{ id: number; hora_inicio: string; hora_fin: string; precio: number }>;
  productos?: Array<{ id: number; nombre: string; precio: number }>;
}

type Tab = 'posts' | 'promos';

export function AdminPanel({ clubId, clubNombre, tarifas = [], productos = [] }: AdminPanelProps) {
  const { crearPost, crearPromo, isLoading, error } = useAdminPanel();
  const [tab, setTab] = useState<Tab>('posts');

  // Post form
  const [postForm, setPostForm] = useState({
    titulo: '',
    contenido: '',
    tipo: 'noticia' as const,
    imagen_url: '',
  });
  const [postSuccess, setPostSuccess] = useState(false);

  // Promo form
  const [promoForm, setPromoForm] = useState({
    tipo: 'descuento_tarifa' as 'descuento_tarifa' | '2x1_producto',
    nombre: '',
    descripcion: '',
    tarifa_id: '',
    porcentaje_descuento: '',
    producto_id: '',
  });
  const [promoSuccess, setPromoSuccess] = useState(false);

  async function handleCrearPost(e: React.FormEvent) {
    e.preventDefault();
    try {
      await crearPost({
        club_id: clubId,
        titulo: postForm.titulo,
        contenido: postForm.contenido,
        tipo: postForm.tipo,
        imagen_url: postForm.imagen_url || undefined,
      });
      setPostForm({ titulo: '', contenido: '', tipo: 'noticia', imagen_url: '' });
      setPostSuccess(true);
      setTimeout(() => setPostSuccess(false), 3000);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleCrearPromo(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (promoForm.tipo === 'descuento_tarifa') {
        await crearPromo({
          club_id: clubId,
          tipo: 'descuento_tarifa',
          nombre: promoForm.nombre,
          descripcion: promoForm.descripcion || undefined,
          tarifa_id: parseInt(promoForm.tarifa_id),
          porcentaje_descuento: parseInt(promoForm.porcentaje_descuento),
        });
      } else {
        await crearPromo({
          club_id: clubId,
          tipo: '2x1_producto',
          nombre: promoForm.nombre,
          descripcion: promoForm.descripcion || undefined,
          producto_id: parseInt(promoForm.producto_id),
        });
      }
      setPromoForm({
        tipo: 'descuento_tarifa',
        nombre: '',
        descripcion: '',
        tarifa_id: '',
        porcentaje_descuento: '',
        producto_id: '',
      });
      setPromoSuccess(true);
      setTimeout(() => setPromoSuccess(false), 3000);
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="rounded-2xl border-2 border-blue-200 bg-blue-50 p-4">
      <div className="mb-4 rounded-lg bg-blue-100 px-3 py-2">
        <p className="text-xs font-bold text-blue-900">👨‍💼 PANEL ADMIN</p>
        <p className="text-sm font-bold text-blue-900">{clubNombre}</p>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setTab('posts')}
          className={`flex-1 rounded-lg px-3 py-2 font-bold text-sm transition ${
            tab === 'posts'
              ? 'bg-blue-500 text-white'
              : 'border-2 border-blue-300 text-blue-700 hover:bg-blue-100'
          }`}
        >
          📰 Posts
        </button>
        <button
          onClick={() => setTab('promos')}
          className={`flex-1 rounded-lg px-3 py-2 font-bold text-sm transition ${
            tab === 'promos'
              ? 'bg-blue-500 text-white'
              : 'border-2 border-blue-300 text-blue-700 hover:bg-blue-100'
          }`}
        >
          🎉 Promociones
        </button>
      </div>

      {/* Posts Tab */}
      {tab === 'posts' && (
        <form onSubmit={handleCrearPost} className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Tipo</label>
            <select
              value={postForm.tipo}
              onChange={(e) =>
                setPostForm({ ...postForm, tipo: e.target.value as any })
              }
              className="w-full rounded-lg border-2 border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="noticia">📰 Noticia</option>
              <option value="promo">🎉 Promoción</option>
              <option value="torneo">🏆 Torneo</option>
              <option value="otro">📌 Otro</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Título</label>
            <input
              type="text"
              value={postForm.titulo}
              onChange={(e) => setPostForm({ ...postForm, titulo: e.target.value })}
              placeholder="Ej: Abierto a nuevos jugadores"
              className="w-full rounded-lg border-2 border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Contenido</label>
            <textarea
              value={postForm.contenido}
              onChange={(e) => setPostForm({ ...postForm, contenido: e.target.value })}
              placeholder="Escribe tu mensaje..."
              className="w-full rounded-lg border-2 border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
              rows={3}
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Imagen URL (opcional)</label>
            <input
              type="text"
              value={postForm.imagen_url}
              onChange={(e) => setPostForm({ ...postForm, imagen_url: e.target.value })}
              placeholder="https://..."
              className="w-full rounded-lg border-2 border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          {error && <div className="rounded-lg bg-red-100 px-2 py-1.5 text-xs font-bold text-red-600">{error}</div>}
          {postSuccess && <div className="rounded-lg bg-green-100 px-2 py-1.5 text-xs font-bold text-green-600">✓ Post creado</div>}

          <button
            type="submit"
            disabled={isLoading || !postForm.titulo || !postForm.contenido}
            className="w-full rounded-lg bg-blue-500 px-3 py-2 font-bold text-white hover:bg-blue-600 disabled:opacity-60"
          >
            {isLoading ? 'Creando...' : '+ Publicar'}
          </button>
        </form>
      )}

      {/* Promos Tab */}
      {tab === 'promos' && (
        <form onSubmit={handleCrearPromo} className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Tipo de promoción</label>
            <select
              value={promoForm.tipo}
              onChange={(e) => {
                setPromoForm({
                  ...promoForm,
                  tipo: e.target.value as any,
                  tarifa_id: '',
                  porcentaje_descuento: '',
                  producto_id: '',
                });
              }}
              className="w-full rounded-lg border-2 border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="descuento_tarifa">📉 Descuento en tarifa</option>
              <option value="2x1_producto">2️⃣1️⃣ 2x1 en producto</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Nombre</label>
            <input
              type="text"
              value={promoForm.nombre}
              onChange={(e) => setPromoForm({ ...promoForm, nombre: e.target.value })}
              placeholder="Ej: Happy Hour de la tarde"
              className="w-full rounded-lg border-2 border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Descripción (opcional)</label>
            <textarea
              value={promoForm.descripcion}
              onChange={(e) => setPromoForm({ ...promoForm, descripcion: e.target.value })}
              placeholder="Ej: 20% OFF en reservas entre 14 y 17hs"
              className="w-full rounded-lg border-2 border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
              rows={2}
            />
          </div>

          {promoForm.tipo === 'descuento_tarifa' && (
            <>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Tarifa</label>
                <select
                  value={promoForm.tarifa_id}
                  onChange={(e) => setPromoForm({ ...promoForm, tarifa_id: e.target.value })}
                  className="w-full rounded-lg border-2 border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Seleccionar tarifa...</option>
                  {tarifas.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.hora_inicio} - {t.hora_fin} (${t.precio})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">% Descuento</label>
                <input
                  type="number"
                  value={promoForm.porcentaje_descuento}
                  onChange={(e) => setPromoForm({ ...promoForm, porcentaje_descuento: e.target.value })}
                  placeholder="Ej: 20"
                  className="w-full rounded-lg border-2 border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                  min="1"
                  max="99"
                />
              </div>
            </>
          )}

          {promoForm.tipo === '2x1_producto' && (
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Producto</label>
              <select
                value={promoForm.producto_id}
                onChange={(e) => setPromoForm({ ...promoForm, producto_id: e.target.value })}
                className="w-full rounded-lg border-2 border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="">Seleccionar producto...</option>
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} (${p.precio})
                  </option>
                ))}
              </select>
            </div>
          )}

          {error && <div className="rounded-lg bg-red-100 px-2 py-1.5 text-xs font-bold text-red-600">{error}</div>}
          {promoSuccess && <div className="rounded-lg bg-green-100 px-2 py-1.5 text-xs font-bold text-green-600">✓ Promoción creada</div>}

          <button
            type="submit"
            disabled={
              isLoading ||
              !promoForm.nombre ||
              (promoForm.tipo === 'descuento_tarifa' && (!promoForm.tarifa_id || !promoForm.porcentaje_descuento)) ||
              (promoForm.tipo === '2x1_producto' && !promoForm.producto_id)
            }
            className="w-full rounded-lg bg-blue-500 px-3 py-2 font-bold text-white hover:bg-blue-600 disabled:opacity-60"
          >
            {isLoading ? 'Creando...' : '+ Crear promoción'}
          </button>
        </form>
      )}
    </div>
  );
}
