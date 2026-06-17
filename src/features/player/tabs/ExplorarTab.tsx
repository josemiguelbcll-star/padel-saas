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
        borderRadius: 16,
        border: '1px solid var(--mgp-border)',
        overflow: 'hidden',
        marginBottom: 12,
        cursor: 'pointer',
        textAlign: 'left',
        padding: '12px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        fontFamily: "'Inter', sans-serif",
        boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
      }}
    >
      {/* Miniatura cuadrada — no se deforma y ocupa poco espacio */}
      <div style={{
        width: 80,
        height: 80,
        borderRadius: 12,
        overflow: 'hidden',
        flexShrink: 0,
        background: '#F1F5F9',
        border: '1px solid #E2E8F0',
      }}>
        <img 
          src={foto} 
          alt={club.nombre} 
          style={{ 
            width: '100%', 
            height: '100%', 
            objectFit: 'cover' 
          }} 
        />
      </div>

      {/* Info a la derecha */}
      <div style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 6,
      }}>
        <p style={{
          fontFamily: "'Poppins', sans-serif",
          fontWeight: 700,
          fontSize: 15,
          color: 'var(--mgp-marino)',
          margin: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {club.nombre}
        </p>
        
        {/* Ubicación */}
        <div style={{
          display: 'flex', 
          alignItems: 'center', 
          gap: 4,
          color: 'var(--mgp-muted)',
        }}>
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          <span style={{ fontSize: 12, fontWeight: 500 }}>
            {club.ciudad ?? 'Salta'}
          </span>
        </div>

        {/* Badge deportivo */}
        <span style={{
          alignSelf: 'flex-start',
          background: 'rgba(57, 197, 74, 0.12)',
          color: '#16A34A',
          fontSize: 10,
          fontWeight: 700,
          padding: '2px 8px',
          borderRadius: 99,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          Disponible
        </span>
      </div>

      {/* Botón sutil con flecha */}
      <div style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: '#F1F5F9',
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        color: 'var(--mgp-marino)',
      }}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
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
