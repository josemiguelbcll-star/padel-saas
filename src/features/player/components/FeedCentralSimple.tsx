import { Heart, Users, Clock } from 'lucide-react';
import { useNoticiasAppFeed } from '../hooks/useNoticiasAppFeed';
import { useTurnosAbiertosApp } from '../hooks/useTurnosAbiertosApp';

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
 * Feed Central Simple - Noticias + Turnos
 */
export function FeedCentralSimple() {
  const { data: noticias, isLoading: noticiasLoading } = useNoticiasAppFeed();
  const { data: turnosAbiertos, isLoading: turnosLoading } = useTurnosAbiertosApp();

  const isLoading = noticiasLoading || turnosLoading;

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-48 bg-gray-100 rounded-2xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Noticias */}
      {noticias && noticias.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-black uppercase tracking-widest text-gray-500 px-2">
            📱 Noticias
          </h3>
          {noticias.map((noticia) => (
            <div
              key={noticia.id}
              className="rounded-2xl overflow-hidden border border-gray-200 bg-white shadow-sm hover:shadow-md transition"
            >
              {/* Imagen (si existe) - Instagram 4:5 */}
              {noticia.imagen_url && (
                <div className="relative w-full overflow-hidden" style={{ aspectRatio: '4/5', background: '#F1F5F9' }}>
                  <img
                    src={noticia.imagen_url}
                    alt={noticia.titulo}
                    className="w-full h-full object-cover"
                    onError={(e) => (e.currentTarget.style.display = 'none')}
                  />
                  {/* Overlay gradient */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                </div>
              )}

              {/* Contenido */}
              <div className="px-4 py-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <h4 className="font-bold text-gray-900 text-sm">{noticia.titulo}</h4>
                    <p className="text-xs text-gray-500 mt-0.5">{noticia.club_nombre}</p>
                  </div>
                </div>

                {noticia.descripcion && (
                  <p className="text-xs text-gray-600 line-clamp-2">{noticia.descripcion}</p>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                  <p className="text-xs text-gray-400">
                    {new Date(noticia.creado_en).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
                  </p>
                  <button className="text-xs font-semibold text-red-600 hover:text-red-700 flex items-center gap-1">
                    <Heart className="h-3 w-3" />
                    Me gusta
                  </button>
                </div>
              </div>
            </div>
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
              className="rounded-2xl border border-green-200 bg-green-50 p-3 shadow-sm"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <p className="text-xs font-bold text-green-900">{turno.club_nombre}</p>
                  <p className="text-xs text-green-700">{turno.cancha_nombre}</p>
                </div>
                <div className="flex items-center gap-1 bg-green-200 text-green-900 px-2 py-1 rounded-full">
                  <Users className="h-3 w-3" />
                  <span className="text-xs font-bold">{turno.vacias}</span>
                </div>
              </div>

              <div className="flex items-center gap-3 text-xs text-green-800">
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
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
      {(!noticias || noticias.length === 0) && (!turnosAbiertos || turnosAbiertos.length === 0) && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 py-12 text-center">
          <p className="text-sm text-gray-500 mb-1">No hay noticias ni turnos disponibles</p>
          <p className="text-xs text-gray-400">Vuelve más tarde 🎾</p>
        </div>
      )}
    </div>
  );
}
