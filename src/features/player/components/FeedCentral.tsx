import { MapPin, Users, Trophy, Clock } from 'lucide-react';
import { useClubPosts } from '../hooks/useClubPosts';
import { useTurnosAbiertosApp } from '../hooks/useTurnosAbiertosApp';

const DIAS  = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function formatearFecha(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${DIAS[dt.getDay()]} ${d} ${MESES[m - 1]}`;
}

function formatearHora(time: string): string {
  return time.slice(0, 5);
}

function obtenerIconoTipo(tipo: string) {
  switch (tipo) {
    case 'promo':    return <span className="text-yellow-500">🎉</span>;
    case 'torneo':   return <Trophy className="h-4 w-4 text-blue-500" />;
    case 'noticia':  return <span className="text-gray-500">📰</span>;
    default:         return <span className="text-gray-400">•</span>;
  }
}

export function FeedCentral() {
  const { data: posts, isLoading: postsLoading } = useClubPosts();
  const { data: turnosAbiertos, isLoading: turnosLoading } = useTurnosAbiertosApp();

  const isLoading = postsLoading || turnosLoading;

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Posts del feed ── */}
      {posts && posts.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-black uppercase tracking-widest text-gray-500">
            Noticias de clubes
          </h3>
          {posts.slice(0, 3).map(post => (
            <div
              key={post.id}
              className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md transition"
            >
              {/* Encabezado */}
              <div className="flex items-start gap-2 mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    {obtenerIconoTipo(post.tipo)}
                    <span className="text-xs font-bold text-gray-500 uppercase">
                      {post.tipo}
                    </span>
                    <span className="text-xs text-gray-400">
                      {post.club_nombre}
                    </span>
                  </div>
                  <h4 className="mt-1 font-bold text-gray-900 text-sm line-clamp-2">
                    {post.titulo}
                  </h4>
                </div>
              </div>

              {/* Contenido */}
              <p className="text-xs text-gray-600 line-clamp-2 mb-2">
                {post.contenido}
              </p>

              {/* Imagen (si existe) */}
              {post.imagen_url && (
                <div className="mb-2 rounded-xl overflow-hidden bg-gray-100 aspect-video">
                  <img
                    src={post.imagen_url}
                    alt={post.titulo}
                    className="h-full w-full object-cover"
                    onError={(e) => (e.currentTarget.style.display = 'none')}
                  />
                </div>
              )}

              {/* Footer */}
              <div className="text-[10px] text-gray-400">
                {new Date(post.creado_en).toLocaleDateString('es-AR', {
                  day: 'numeric',
                  month: 'short',
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Turnos abiertos ── */}
      {turnosAbiertos && turnosAbiertos.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-black uppercase tracking-widest text-gray-500">
            Turnos disponibles esta semana
          </h3>
          {turnosAbiertos.slice(0, 4).map(turno => (
            <div
              key={`${turno.club_id}|${turno.cancha_id}|${turno.fecha}|${turno.hora_inicio}`}
              className="rounded-2xl border border-green-200 bg-green-50 p-3 shadow-sm"
            >
              {/* Club + Cancha */}
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <p className="text-xs font-bold text-green-900">
                    {turno.club_nombre}
                  </p>
                  <p className="text-xs text-green-700">
                    {turno.cancha_nombre}
                  </p>
                </div>
                <div className="flex items-center gap-1 bg-green-200 text-green-900 px-2 py-1 rounded-full">
                  <Users className="h-3 w-3" />
                  <span className="text-xs font-bold">{turno.vacias}</span>
                </div>
              </div>

              {/* Fecha + Hora */}
              <div className="flex items-center gap-3 text-xs text-green-800">
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  <span className="font-semibold">
                    {formatearFecha(turno.fecha)} · {formatearHora(turno.hora_inicio)}
                  </span>
                </div>
                <span className="text-green-600">
                  ${turno.precio.toLocaleString('es-AR')}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {(!posts || posts.length === 0) && (!turnosAbiertos || turnosAbiertos.length === 0) && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 py-8 text-center">
          <p className="text-sm text-gray-500">
            No hay noticias ni turnos disponibles por ahora.
          </p>
        </div>
      )}
    </div>
  );
}
