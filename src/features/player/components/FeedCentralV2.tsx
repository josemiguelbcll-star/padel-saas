import { useState, useEffect } from 'react';
import { Users, Clock, Heart } from 'lucide-react';
import { useClubPosts } from '../hooks/useClubPosts';
import { useTurnosAbiertosApp } from '../hooks/useTurnosAbiertosApp';
import { useAdminPanelV2 } from '../hooks/useAdminPanelV2';

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function formatearFecha(iso: string): string {
  const parts = iso.split('-').map(Number);
  const y = parts[0] ?? new Date().getFullYear();
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const dt = new Date(y, m - 1, d);
  return `${DIAS[dt.getDay()]} ${d} ${MESES[m - 1]}`;
}

function formatearHora(time: string): string {
  return time.slice(0, 5);
}

/**
 * Countdown timer component
 */
function Countdown({ expiresAt }: { expiresAt: string }) {
  const [timeLeft, setTimeLeft] = useState<{
    dias: number;
    horas: number;
    minutos: number;
  } | null>(null);

  useEffect(() => {
    const updateTimer = () => {
      const ahora = new Date();
      const expira = new Date(expiresAt);
      const diff = expira.getTime() - ahora.getTime();

      if (diff <= 0) {
        setTimeLeft(null);
        return;
      }

      const totalMinutos = Math.floor(diff / 1000 / 60);
      const dias = Math.floor(totalMinutos / (24 * 60));
      const horas = Math.floor((totalMinutos % (24 * 60)) / 60);
      const minutos = totalMinutos % 60;

      setTimeLeft({ dias, horas, minutos });
    };

    updateTimer();
    const interval = setInterval(updateTimer, 30000); // Update cada 30s

    return () => clearInterval(interval);
  }, [expiresAt]);

  if (!timeLeft) return <span className="text-xs text-gray-500">Expirado</span>;

  if (timeLeft.dias > 0) {
    return (
      <span className="text-xs font-bold text-red-600">
        ⏱️ Expira en {timeLeft.dias}d {timeLeft.horas}h
      </span>
    );
  }

  return (
    <span className={`text-xs font-bold ${timeLeft.horas < 1 ? 'text-red-600 animate-pulse' : 'text-orange-600'}`}>
      ⏱️ Expira en {timeLeft.horas}h {timeLeft.minutos}m
    </span>
  );
}

/**
 * Post Card con diseño Instagram-style
 */
function PostCard({ post }: { post: any }) {
  const { darMeGusta } = useAdminPanelV2();
  const [meGustaCuenta, setMeGustaCuenta] = useState(post.reacciones || 0);
  const [loading, setLoading] = useState(false);
  const [yaLike, setYaLike] = useState(false);

  async function handleMeGusta() {
    setLoading(true);
    try {
      const nueva = await darMeGusta(post.id);
      setMeGustaCuenta(nueva);
      setYaLike(true);
      setTimeout(() => setYaLike(false), 500);
    } catch (err) {
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl overflow-hidden border border-gray-200 bg-white shadow-md hover:shadow-lg transition">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div>
          <p className="text-sm font-bold text-gray-900">{post.club_nombre}</p>
          <p className="text-xs text-gray-500">
            {post.tipo === 'promo' && '🎉'}
            {post.tipo === 'torneo' && '🏆'}
            {post.tipo === 'noticia' && '📰'}
            {' '}
            {post.tipo.toUpperCase()}
          </p>
        </div>
        {post.badge && (
          <span className="inline-block px-3 py-1 bg-red-100 text-red-700 text-xs font-bold rounded-full">
            {post.badge}
          </span>
        )}
      </div>

      {/* Imagen (si existe) */}
      {post.imagen_url && (
        <div className="relative w-full bg-gray-100 aspect-video overflow-hidden">
          <img
            src={post.imagen_url}
            alt={post.titulo}
            className="w-full h-full object-cover"
            onError={(e) => (e.currentTarget.style.display = 'none')}
          />
          {/* Overlay de info sobre imagen */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex flex-col justify-end p-4">
            <h3 className="font-bold text-white text-base line-clamp-2">
              {post.titulo}
            </h3>
          </div>
        </div>
      )}

      {/* Contenido */}
      <div className="px-4 py-3 space-y-2">
        {!post.imagen_url && (
          <h3 className="font-bold text-gray-900 text-base">{post.titulo}</h3>
        )}
        <p className="text-sm text-gray-600 line-clamp-3">{post.contenido}</p>

        {/* CTA */}
        {post.cta_link && post.cta_texto && (
          <button className="w-full mt-3 rounded-lg bg-gradient-to-r from-blue-500 to-cyan-500 px-4 py-2.5 text-sm font-bold text-white hover:shadow-md transition">
            {post.cta_texto} →
          </button>
        )}
      </div>

      {/* Footer: Countdown + Me gusta */}
      <div className="border-t border-gray-100 px-4 py-3 space-y-3">
        {/* Countdown */}
        {post.expira_en && (
          <div className="flex justify-between items-center">
            <Countdown expiresAt={post.expira_en} />
            <span className="text-xs text-gray-400">
              {new Date(post.creado_en).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
            </span>
          </div>
        )}

        {/* Me gusta */}
        <button
          onClick={handleMeGusta}
          disabled={loading}
          className={`w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg font-semibold transition ${
            yaLike
              ? 'bg-red-100 text-red-700 scale-105'
              : 'bg-gray-50 text-gray-700 hover:bg-red-50 hover:text-red-600'
          } disabled:opacity-50`}
        >
          <Heart className={`h-5 w-5 ${yaLike ? 'fill-current' : ''}`} />
          Me gusta {meGustaCuenta > 0 && `(${meGustaCuenta})`}
        </button>
      </div>
    </div>
  );
}

/**
 * Feed Central V2: Posts temporales + Turnos
 */
export function FeedCentralV2() {
  const { data: posts, isLoading: postsLoading } = useClubPosts();
  const { data: turnosAbiertos, isLoading: turnosLoading } = useTurnosAbiertosApp();

  const isLoading = postsLoading || turnosLoading;

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-64 bg-gradient-to-b from-gray-100 to-gray-50 rounded-2xl animate-pulse" />
        ))}
      </div>
    );
  }

  const postsActivos = posts?.filter((p) => {
    if (!p.expira_en) return true;
    return new Date(p.expira_en) > new Date();
  }) || [];

  return (
    <div className="space-y-4">
      {/* Posts */}
      {postsActivos.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-2">
            <h3 className="text-xs font-black uppercase tracking-widest text-gray-500">
              📱 Feed Central
            </h3>
            <span className="text-xs text-gray-400">{postsActivos.length} activos</span>
          </div>
          {postsActivos.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}

      {/* Turnos abiertos */}
      {turnosAbiertos && turnosAbiertos.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-black uppercase tracking-widest text-gray-500 px-2">
            🎾 Turnos disponibles esta semana
          </h3>
          {turnosAbiertos.slice(0, 4).map((turno) => (
            <div
              key={`${turno.club_id}|${turno.cancha_id}|${turno.fecha}|${turno.hora_inicio}`}
              className="rounded-2xl border border-green-200 bg-green-50 p-4 shadow-sm hover:shadow-md transition"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <p className="text-sm font-bold text-green-900">{turno.club_nombre}</p>
                  <p className="text-xs text-green-700">{turno.cancha_nombre}</p>
                </div>
                <div className="flex items-center gap-1 bg-green-200 text-green-900 px-2.5 py-1 rounded-full">
                  <Users className="h-4 w-4" />
                  <span className="text-xs font-bold">{turno.vacias}</span>
                </div>
              </div>

              <div className="flex items-center gap-3 text-xs text-green-800">
                <div className="flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  <span className="font-semibold">
                    {formatearFecha(turno.fecha)} · {formatearHora(turno.hora_inicio)}
                  </span>
                </div>
                <span className="text-green-600 font-bold">
                  ${turno.precio.toLocaleString('es-AR')}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {postsActivos.length === 0 && (!turnosAbiertos || turnosAbiertos.length === 0) && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 py-12 text-center">
          <p className="text-sm text-gray-500 mb-2">No hay noticias ni turnos disponibles</p>
          <p className="text-xs text-gray-400">Vuelve más tarde para ver las últimas ofertas 🎾</p>
        </div>
      )}
    </div>
  );
}
