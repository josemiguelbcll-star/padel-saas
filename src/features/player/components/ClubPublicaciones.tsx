import { useNoticiasAppFeed } from '../hooks/useNoticiasAppFeed';
import { NoticiaCard } from './NoticiaCard';

export function ClubPublicaciones({
  clubId,
  clubNombre,
}: {
  clubId: number;
  clubNombre: string;
}) {
  const { data, isLoading, isError } = useNoticiasAppFeed(clubId);

  if (isLoading) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground">
          Publicaciones
        </h3>
        <div className="h-32 animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  }

  if (isError || !data || data.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground">
          Publicaciones
        </h3>
        <span className="text-[11px] font-medium text-muted-foreground">
          {data.length === 1 ? '1 publicación' : `${data.length} publicaciones`}
        </span>
      </div>
      <div className="space-y-3">
        {data.map((noticia) => (
          <div
            key={noticia.id}
            className="overflow-hidden rounded-2xl border border-border bg-card"
          >
            <NoticiaCard
              noticia={{ ...noticia, club_nombre: clubNombre || noticia.club_nombre }}
              compact
            />
          </div>
        ))}
      </div>
    </div>
  );
}
