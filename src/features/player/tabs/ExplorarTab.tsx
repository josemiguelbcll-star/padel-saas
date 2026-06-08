import { useClubsPublicos } from '@/features/landing/hooks/useClubsPublicos';

// ── Fotos reales de canchas de pádel (Pexels — licencia libre) ─────────────
const COURT_PHOTOS = [
  'https://images.pexels.com/photos/32474981/pexels-photo-32474981/free-photo-of-indoor-padel-court-with-blue-surface.jpeg?auto=compress&cs=tinysrgb&w=800&h=400&fit=crop',
  'https://images.pexels.com/photos/35261961/pexels-photo-35261961/free-photo-of-dynamic-indoor-padel-tennis-match-action.jpeg?auto=compress&cs=tinysrgb&w=800&h=400&fit=crop',
  'https://images.pexels.com/photos/32897040/pexels-photo-32897040/free-photo-of-vibrant-indoor-padel-court-with-racket-and-balls.jpeg?auto=compress&cs=tinysrgb&w=800&h=400&fit=crop',
  'https://images.pexels.com/photos/35525977/pexels-photo-35525977/free-photo-of-man-playing-paddle-tennis-on-blue-court.jpeg?auto=compress&cs=tinysrgb&w=800&h=400&fit=crop',
  'https://images.pexels.com/photos/35248501/pexels-photo-35248501/free-photo-of-group-of-women-playing-indoor-padel-tennis.jpeg?auto=compress&cs=tinysrgb&w=800&h=400&fit=crop',
];

function courtPhoto(clubId: number, portada_url: string | null): string {
  if (portada_url) return portada_url;
  return COURT_PHOTOS[clubId % COURT_PHOTOS.length] ?? COURT_PHOTOS[0]!;
}

// ── Club card ─────────────────────────────────────────────────────────────────

interface ClubCardProps {
  club: {
    id: number;
    nombre: string;
    slug: string;
    ciudad: string | null;
    portada_url: string | null;
  };
  onSelect: (slug: string) => void;
}

function ClubCard({ club, onSelect }: ClubCardProps) {
  const foto = courtPhoto(club.id, club.portada_url);

  return (
    <button
      onClick={() => onSelect(club.slug)}
      style={{
        width: '100%',
        background: '#ffffff',
        borderRadius: 18,
        border: '1.5px solid var(--mgp-border)',
        overflow: 'hidden',
        marginBottom: 14,
        cursor: 'pointer',
        textAlign: 'left',
        padding: 0,
        display: 'block',
        fontFamily: "'Inter', sans-serif",
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      }}
    >
      {/* Foto de portada — siempre real */}
      <div style={{
        height: 148,
        background: `url(${foto}) center/cover`,
        position: 'relative',
      }}>
        {/* Overlay degradado sutil en la parte inferior */}
        <div style={{
          position: 'absolute',
          bottom: 0, left: 0, right: 0,
          height: 56,
          background: 'linear-gradient(to top, rgba(11,31,77,0.55) 0%, transparent 100%)',
        }} />
        {/* Ciudad sobre la imagen */}
        <div style={{
          position: 'absolute',
          bottom: 10, left: 14,
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none"
            stroke="rgba(255,255,255,0.9)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
            {club.ciudad ?? 'Salta'}
          </span>
        </div>
      </div>

      {/* Info */}
      <div style={{
        padding: '13px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}>
        <p style={{
          fontFamily: "'Poppins', sans-serif",
          fontWeight: 700,
          fontSize: 16,
          color: 'var(--mgp-marino)',
          margin: 0,
          flex: 1,
          minWidth: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {club.nombre}
        </p>
        <div style={{
          background: 'var(--mgp-marino)',
          color: '#ffffff',
          fontSize: 13,
          fontWeight: 600,
          padding: '8px 14px',
          borderRadius: 99,
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}>
          Ver turnos →
        </div>
      </div>
    </button>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export function ExplorarTab({ onSelectClub }: { onSelectClub: (slug: string) => void }) {
  const { data: clubs, isLoading, error } = useClubsPublicos();

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '16px 16px 80px' }}>

      <p style={{
        fontFamily: "'Poppins', sans-serif",
        fontWeight: 700,
        fontSize: 20,
        color: 'var(--mgp-marino)',
        margin: '0 0 4px',
      }}>
        Clubes en Salta
      </p>
      <p style={{ fontSize: 14, color: 'var(--mgp-muted)', margin: '0 0 16px' }}>
        Tocá un club para ver turnos disponibles
      </p>

      {isLoading && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🎾</div>
          <p style={{ color: 'var(--mgp-muted)', fontSize: 14 }}>Cargando clubes…</p>
        </div>
      )}

      {error && (
        <div style={{
          background: 'var(--mgp-danger-bg)',
          border: '1.5px solid #FECACA',
          borderRadius: 14,
          padding: '14px 16px',
        }}>
          <p style={{ color: 'var(--mgp-danger)', fontSize: 14, margin: 0 }}>
            No se pudieron cargar los clubes. Verificá tu conexión.
          </p>
        </div>
      )}

      {clubs?.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🏟️</div>
          <p style={{ color: 'var(--mgp-muted)', fontSize: 14 }}>No hay clubes disponibles aún</p>
        </div>
      )}

      {clubs?.map((club) => (
        <ClubCard key={club.id} club={club} onSelect={onSelectClub} />
      ))}
    </div>
  );
}
