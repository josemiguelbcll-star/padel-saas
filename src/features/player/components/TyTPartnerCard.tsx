import { useState, useRef } from 'react';
import { Play, Pause, ArrowUpRight } from 'lucide-react';

const TYT_INSTAGRAM_URL = 'https://www.instagram.com/padel.tyt/';

function InstagramIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

export function TyTPartnerCard() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      void videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  return (
    <div
      style={{
        background: '#ffffff',
        border: '1.5px solid var(--mgp-border)',
        borderRadius: 20,
        overflow: 'hidden',
        boxShadow: '0 4px 16px rgba(11, 31, 77, 0.05)',
      }}
    >
      {/* ── Encabezado con Logo Oficial de T&T Pádel ── */}
      <div
        style={{
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #F1F5F9',
        }}
      >
        <a
          href={TYT_INSTAGRAM_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <img
            src="/assets/tyt-logo.jpg"
            alt="T&T Pádel"
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              objectFit: 'cover',
              border: '1.5px solid #E2E8F0',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
            }}
          />
          <div>
            <h3
              style={{
                margin: 0,
                fontSize: 15,
                fontWeight: 800,
                fontFamily: "'Poppins', sans-serif",
                color: 'var(--mgp-marino)',
                lineHeight: 1.2,
              }}
            >
              T&T Pádel
            </h3>
            <p
              style={{
                margin: '2px 0 0',
                fontSize: 11,
                color: 'var(--mgp-muted)',
                fontWeight: 500,
              }}
            >
              @padel.tyt · Canchas y comunidad
            </p>
          </div>
        </a>

        <a
          href={TYT_INSTAGRAM_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '6px 12px',
            borderRadius: 99,
            background: '#F1F5F9',
            color: 'var(--mgp-marino)',
            fontSize: 11,
            fontWeight: 700,
            textDecoration: 'none',
            transition: 'background 0.15s ease',
          }}
        >
          <InstagramIcon size={13} />
          <span>Seguir</span>
          <ArrowUpRight size={12} />
        </a>
      </div>

      {/* ── Reproductor de Video (Video continuo sin controles de sonido) ── */}
      <div
        style={{
          position: 'relative',
          background: '#090D16',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          maxHeight: 380,
          overflow: 'hidden',
        }}
      >
        <video
          ref={videoRef}
          src="/assets/tyt-partner.mp4"
          playsInline
          autoPlay
          muted
          loop
          onClick={togglePlay}
          style={{
            width: '100%',
            maxHeight: 380,
            objectFit: 'contain',
            cursor: 'pointer',
            display: 'block',
          }}
        />

        {/* Botón discreto de pausa/reproducción al hacer click */}
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            right: 12,
            zIndex: 10,
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
            aria-label={isPlaying ? 'Pausar video' : 'Reproducir video'}
            style={{
              background: 'rgba(11, 31, 77, 0.75)',
              backdropFilter: 'blur(8px)',
              color: '#ffffff',
              border: '1px solid rgba(255, 255, 255, 0.25)',
              borderRadius: 99,
              width: 34,
              height: 34,
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
            }}
          >
            {isPlaying ? <Pause size={15} /> : <Play size={15} />}
          </button>
        </div>
      </div>

      {/* ── Pie con Call To Action a Instagram ── */}
      <div
        style={{
          padding: '14px 18px',
          background: '#FAFAFC',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 800,
              fontFamily: "'Poppins', sans-serif",
              color: 'var(--mgp-marino)',
            }}
          >
            Conectá con @padel.tyt
          </p>
          <p
            style={{
              margin: '2px 0 0',
              fontSize: 11,
              color: 'var(--mgp-muted)',
            }}
          >
            Seguí sus torneos, clínicas y canchas en Instagram.
          </p>
        </div>

        {/* <a
          href={TYT_INSTAGRAM_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            background: 'linear-gradient(135deg, #E1306C 0%, #C13584 50%, #833AB4 100%)',
            color: '#ffffff',
            textDecoration: 'none',
            borderRadius: 99,
            padding: '8px 16px',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            boxShadow: '0 3px 12px rgba(193, 53, 132, 0.28)',
            transition: 'transform 0.15s ease',
          }}
        >
          <InstagramIcon size={14} />
          <span>Ver Instagram</span>
          <ArrowUpRight size={13} />
        </a> */}
      </div>
    </div>
  );
}
