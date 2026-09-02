import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Trophy, CheckCircle2, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

gsap.registerPlugin(ScrollTrigger);

export interface PadelTag {
  id: string;
  text: string;
  background: string;
  color: string;
  border: string;
}

const PADEL_TAGS: PadelTag[] = [
  {
    id: 'tag-1',
    text: '🎾 Grilla con bloqueo atómico anti-solapamiento',
    background: '#ffffff',
    color: '#00A859',
    border: '#A7F3D0',
  },
  {
    id: 'tag-2',
    text: '👥 Cuenta del turno & División 4 jugadores',
    background: '#ffffff',
    color: '#2563EB',
    border: '#BFDBFE',
  },
  {
    id: 'tag-3',
    text: '📊 Estado de Resultados por unidad (Canchas/Buffet/Clases)',
    background: '#ffffff',
    color: '#181A1B',
    border: '#E2DDD1',
  },
  {
    id: 'tag-4',
    text: '🔒 Cierre de caja estricto con arqueo y trazabilidad',
    background: '#ffffff',
    color: '#E11D48',
    border: '#FECDD3',
  },
  {
    id: 'tag-5',
    text: '🥤 Punto de venta con descuento de stock en vivo',
    background: '#ffffff',
    color: '#D97706',
    border: '#FDE68A',
  },
];

export function PadelScrollReveal() {
  const containerRef = useRef<HTMLDivElement>(null);
  const benefitRef = useRef<HTMLDivElement>(null);
  const videoWrapperRef = useRef<HTMLDivElement>(null);
  const videoBoxRef = useRef<HTMLDivElement>(null);
  const tagRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const ctx = gsap.context(() => {
      // Reveal timeline for tag badges
      const revealTl = gsap.timeline({
        scrollTrigger: {
          trigger: benefitRef.current,
          start: 'top 75%',
          end: 'bottom 50%',
          scrub: 1,
        },
      });

      tagRefs.current.forEach((tagEl) => {
        if (tagEl) {
          revealTl.fromTo(
            tagEl,
            { opacity: 0, y: 30, scale: 0.92 },
            {
              opacity: 1,
              y: 0,
              scale: 1,
              duration: 0.8,
              ease: 'power2.out',
            },
            '>-0.3'
          );
        }
      });

      // Video expansion circular reveal on scroll
      if (videoWrapperRef.current && videoBoxRef.current) {
        const vpTl = gsap.timeline({
          scrollTrigger: {
            trigger: videoWrapperRef.current,
            start: 'top 60%',
            end: 'bottom 20%',
            scrub: 1.2,
          },
        });

        vpTl.fromTo(
          videoBoxRef.current,
          { clipPath: 'inset(18% 15% 18% 15% round 32px)', scale: 0.9 },
          { clipPath: 'inset(0% 0% 0% 0% round 24px)', scale: 1, ease: 'power1.inOut' }
        );
      }
    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={containerRef} className="w-full bg-[#ECE8DE] text-slate-900 py-24 relative overflow-hidden border-y border-[#E2DDD1]">
      {/* Background glow lines */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(0,168,89,0.06),transparent_70%)] pointer-events-none" />

      <div className="container mx-auto px-4 relative z-10">
        {/* Intro text */}
        <div className="text-center max-w-4xl mx-auto mb-16">
          <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white border border-[#A7F3D0] text-[#00A859] text-xs font-bold uppercase tracking-wider mb-4 shadow-sm">
            <Trophy className="h-3.5 w-3.5" />
            Software Especializado en Pádel & Tenis
          </span>
          <h2 className="text-3xl sm:text-5xl md:text-6xl font-black text-slate-900 tracking-tight leading-[1.1] mb-6">
            La grilla llena. La caja cuadrada.{' '}
            <span className="text-[#00A859]">Tus finanzas claras en vivo.</span>
          </h2>
          <p className="text-base sm:text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
            Eliminá planillas paralelas y discusiones en el mostrador. MatchGo conecta la
            reserva del jugador, el cobro en recepción y el balance del club en una sola plataforma.
          </p>
        </div>

        {/* Staggered Tag Badges */}
        <div ref={benefitRef} className="flex flex-wrap justify-center gap-3.5 max-w-4xl mx-auto mb-20">
          {PADEL_TAGS.map((tag, idx) => (
            <div
              key={tag.id}
              ref={(el) => {
                tagRefs.current[idx] = el;
              }}
              className="px-5 py-3 rounded-2xl text-xs sm:text-sm font-bold tracking-tight shadow-sm flex items-center gap-2.5 transition-transform hover:scale-105"
              style={{
                backgroundColor: tag.background,
                color: tag.color,
                border: `1px solid ${tag.border}`,
              }}
            >
              <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: tag.color }} />
              {tag.text}
            </div>
          ))}
        </div>

        {/* Video / Visual Expansion Preview */}
        <div ref={videoWrapperRef} className="max-w-5xl mx-auto mb-16 relative">
          <div
            ref={videoBoxRef}
            className="relative rounded-3xl overflow-hidden border border-[#E2DDD1] bg-white shadow-[0_25px_60px_-15px_rgba(24,26,27,0.1)]"
          >
            <div className="relative aspect-[16/9] w-full">
              <img
                src="/assets/padel-1.jpg"
                alt="MatchGo Pádel Software"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-black/20" />

              {/* Overlay Content */}
              <div className="absolute bottom-6 left-6 right-6 sm:bottom-10 sm:left-10 sm:right-10 flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4">
                <div>
                  <span className="px-3 py-1 rounded-full bg-[#00A859] text-white font-black text-xs uppercase tracking-wider inline-block mb-2 shadow-md">
                    Operación 100% en vivo
                  </span>
                  <h3 className="text-xl sm:text-3xl font-black text-white">
                    Todo lo que pasa en la cancha, registrado al instante
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-200 mt-1 max-w-lg">
                    Desde el alquiler de paletas hasta la recaudación del turno nocturno.
                  </p>
                </div>

                <Link
                  to="/player"
                  className="px-6 py-3 bg-[#00A859] hover:bg-[#008f4c] text-white font-bold rounded-xl text-xs sm:text-sm flex items-center gap-2 shadow-lg shadow-emerald-500/30 transition-all shrink-0"
                >
                  Probar Reserva Online
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Outro text */}
        <div className="text-center max-w-3xl mx-auto pt-8 border-t border-[#E2DDD1]">
          <p className="text-xs uppercase font-extrabold tracking-widest text-[#00A859] mb-2">
            MatchGo para Clubes
          </p>
          <p className="text-lg sm:text-2xl font-bold text-slate-800">
            "La diferencia entre adivinar si tu club gana plata y saber exactamente cuánto rinde cada cancha."
          </p>
        </div>
      </div>
    </div>
  );
}
