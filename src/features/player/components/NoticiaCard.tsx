import { useState } from 'react';
import { Heart, MessageCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useNoticiaSocial } from '../hooks/useNoticiaSocial';
import type { NoticiaAppFeed } from '../hooks/useNoticiasAppFeed';

export function NoticiaCard({
  noticia,
  compact,
}: {
  noticia: NoticiaAppFeed;
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState('');
  const social = useNoticiaSocial(noticia.id, noticia.likes_count);

  async function enviarComentario() {
    const cuerpo = texto.trim();
    if (!cuerpo) return;
    try {
      await social.comentar(cuerpo);
      setTexto('');
      setAbierto(true);
    } catch {
      /* el error se muestra abajo */
    }
  }

  return (
    <article className="flex w-full flex-col bg-white">
      {noticia.imagen_url && (
        <div
          className={cn(
            'relative flex w-full items-center justify-center border-b border-gray-100 bg-slate-100',
            compact ? 'h-52' : 'h-60',
          )}
        >
          <img
            src={noticia.imagen_url}
            alt={noticia.titulo}
            loading="lazy"
            decoding="async"
            className="max-h-full max-w-full object-contain"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        </div>
      )}

      <div className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-extrabold leading-snug text-gray-900 sm:text-base">
              {noticia.titulo}
            </h4>
            {noticia.club_slug ? (
              <button
                type="button"
                onClick={() => navigate(`/club/${noticia.club_slug}?from=player`)}
                className="mt-0.5 text-left text-xs font-bold text-[#1A9B73] hover:underline"
              >
                {noticia.club_nombre}
              </button>
            ) : (
              <p className="mt-0.5 text-xs font-bold text-slate-600">{noticia.club_nombre}</p>
            )}
          </div>
          <span className="shrink-0 text-[11px] font-bold text-gray-400">
            {new Date(noticia.creado_en).toLocaleDateString('es-AR', {
              day: 'numeric',
              month: 'short',
            })}
          </span>
        </div>

        {noticia.descripcion && (
          <p className="pt-0.5 text-xs leading-relaxed text-gray-600">
            {noticia.descripcion}
          </p>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={() => social.toggleLike()}
            disabled={social.likePending}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold transition',
              social.liked
                ? 'bg-rose-50 text-rose-600'
                : 'bg-slate-50 text-slate-600 hover:bg-slate-100',
            )}
          >
            <Heart
              className="h-3.5 w-3.5"
              fill={social.liked ? 'currentColor' : 'none'}
            />
            {social.likesCount > 0 ? social.likesCount : 'Me gusta'}
          </button>
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-600 transition hover:bg-slate-100"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            {Math.max(noticia.comments_count, social.comentarios.length) > 0
              ? Math.max(noticia.comments_count, social.comentarios.length)
              : 'Comentar'}
          </button>
        </div>

        {(social.likeError || social.comentarError) && (
          <p className="text-[11px] font-medium text-amber-700">
            {social.likeError || social.comentarError}.{' '}
            <button
              type="button"
              className="font-bold underline"
              onClick={() => navigate('/player')}
            >
              Ingresá como jugador
            </button>
          </p>
        )}

        {abierto && (
          <div className="space-y-2 border-t border-slate-100 pt-2">
            {social.comentarios.map((c) => (
              <div key={c.id} className="flex gap-2">
                {c.autor_foto ? (
                  <img
                    src={c.autor_foto}
                    alt=""
                    className="h-7 w-7 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#0B1F4D] text-[10px] font-bold text-white">
                    {c.autor_nombre.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1 rounded-xl bg-slate-50 px-2.5 py-1.5">
                  <p className="text-[11px] font-bold text-slate-800">{c.autor_nombre}</p>
                  <p className="text-xs text-slate-600">{c.cuerpo}</p>
                </div>
              </div>
            ))}
            <div className="flex gap-2">
              <input
                value={texto}
                onChange={(e) => setTexto(e.target.value.slice(0, 400))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void enviarComentario();
                  }
                }}
                placeholder="Escribí un comentario…"
                className="h-9 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none focus:border-[#1A9B73]"
              />
              <button
                type="button"
                disabled={social.comentarPending || !texto.trim()}
                onClick={() => void enviarComentario()}
                className="h-9 rounded-xl bg-[#0B1F4D] px-3 text-xs font-bold text-white disabled:opacity-50"
              >
                Enviar
              </button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
