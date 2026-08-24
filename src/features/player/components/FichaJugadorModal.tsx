import { useState } from 'react';
import type { PlayerProfile } from '../hooks/usePlayerProfile';
import type { MiReservaReal } from '../hooks/useMyReservas';

interface FichaJugadorModalProps {
  profile: PlayerProfile;
  historial: MiReservaReal[];
  proximas: MiReservaReal[];
  iniciales: string;
  onClose: () => void;
}

const CAT_LABEL: Record<string, string> = {
  '1ra': '1ª categoría', '2da': '2ª categoría', '3ra': '3ª categoría',
  '4ta': '4ª categoría', '5ta': '5ª categoría', '6ta': '6ª categoría',
  '7ta': '7ª categoría', '8va': '8ª categoría', 'libre': 'Libre',
};

const GENERO_LABEL: Record<string, string> = {
  masculino: 'Masculino ♂',
  femenino: 'Femenino ♀',
  no_especifica: 'No especifica',
};

const POSICION_LABEL: Record<string, string> = {
  drive: 'Drive (Derecha) ↙️',
  reves: 'Revés (Izquierda) ↘️',
  ambos: 'Ambos Lados 🔄',
};

const MANO_LABEL: Record<string, string> = {
  diestro: 'Diestro ✋',
  zurdo: 'Zurdo 🤚',
};

export function FichaJugadorModal({ profile, historial, proximas, iniciales, onClose }: FichaJugadorModalProps) {
  const [copied, setCopied] = useState(false);

  const displayName = profile.nombre || profile.alias || 'Jugador de Pádel';
  const aliasDisplay = profile.alias ? `@${profile.alias}` : null;
  const categoriaText = profile.categoria ? CAT_LABEL[profile.categoria] : 'En clasificación';
  const generoText = profile.genero ? GENERO_LABEL[profile.genero] : 'Sin especificar';
  const posicionText = profile.posicion ? POSICION_LABEL[profile.posicion] : 'Drive / Revés';
  const manoText = profile.mano ? MANO_LABEL[profile.mano] : 'Diestro';

  // Obtener clubes más habituales del historial o próximas reservas
  const clubesSet = new Set<string>();
  [...proximas, ...historial].forEach(r => {
    if (r.club_nombre) clubesSet.add(r.club_nombre);
  });
  const clubesHabituales = Array.from(clubesSet).slice(0, 2);
  const clubesText = clubesHabituales.length > 0 ? clubesHabituales.join(', ') : 'Comunidad MatchGo';

  const partidosContador = historial.length + proximas.length;

  const textoCompartir = `🎾 *FICHA DE JUGADOR DE PÁDEL - MATCHGO*

👤 *Nombre:* ${displayName}
🏷️ *Alias:* ${profile.alias ? `@${profile.alias}` : '—'}
🏆 *Categoría:* ${categoriaText}
👫 *Género:* ${generoText}
🎯 *Posición:* ${profile.posicion ? POSICION_LABEL[profile.posicion] : 'Flexible'}
✋ *Mano:* ${profile.mano ? (profile.mano === 'diestro' ? 'Diestro' : 'Zurdo') : 'Diestro'}
📍 *Juega en:* ${clubesText}
📊 *Partidos en MatchGo:* ${partidosContador}

¡Sumame a tu próximo partido en MatchGo! 🚀
👉 https://matchgo.app/player/jugar`;

  async function handleCopiar() {
    try {
      await navigator.clipboard.writeText(textoCompartir);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }

  function handleWhatsApp() {
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(textoCompartir)}`;
    window.open(url, '_blank');
  }

  async function handleNativeShare() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Ficha de Pádel de ${displayName}`,
          text: textoCompartir,
        });
      } catch {}
    } else {
      handleWhatsApp();
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[140] bg-black/60 backdrop-blur-md animate-fade-in"
        onClick={onClose}
      />

      {/* Container / Card */}
      <div className="fixed inset-x-4 top-[5dvh] bottom-[5dvh] z-[150] max-w-md mx-auto rounded-3xl bg-[#0B1F4D] text-white shadow-2xl overflow-y-auto border-2 border-[#D9F23B]/30 animate-slide-up flex flex-col">
        
        {/* Header bar decorativa */}
        <div className="bg-gradient-to-r from-[#D9F23B] via-[#39C54A] to-[#D9F23B] h-2 w-full shrink-0" />

        <div className="p-6 flex-1 flex flex-col justify-between">
          <div>
            {/* Top Row: Cerrar */}
            <div className="flex justify-between items-center mb-4">
              <span className="text-[11px] font-black uppercase tracking-widest text-[#D9F23B] bg-[#D9F23B]/10 px-3 py-1 rounded-full border border-[#D9F23B]/20">
                🎾 Ficha de Jugador MatchGo
              </span>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/70 hover:text-white hover:bg-white/20 transition"
              >
                ✕
              </button>
            </div>

            {/* Avatar & Player Header */}
            <div className="flex flex-col items-center text-center my-3">
              <div className="relative mb-2">
                {profile.avatar_url ? (
                  <div
                    className="w-20 h-20 rounded-full border-4 border-[#39C54A] shadow-lg bg-cover bg-center"
                    style={{ backgroundImage: `url(${profile.avatar_url})` }}
                  />
                ) : (
                  <div className="w-20 h-20 rounded-full border-4 border-[#39C54A] bg-gradient-to-br from-[#D9F23B] to-[#39C54A] text-[#0B1F4D] flex items-center justify-center font-black text-2xl shadow-lg">
                    {iniciales || '?'}
                  </div>
                )}
                <span className="absolute -bottom-1 -right-1 bg-[#39C54A] text-[#0B1F4D] p-1 rounded-full border-2 border-[#0B1F4D] shadow text-xs">
                  ⚡
                </span>
              </div>

              <h2 className="font-extrabold text-xl tracking-tight text-white m-0">
                {displayName}
              </h2>
              {aliasDisplay && (
                <span className="text-xs font-semibold text-[#D9F23B] mt-0.5">
                  {aliasDisplay}
                </span>
              )}
              
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                <span className="bg-white/10 px-3 py-1 rounded-full border border-white/15 text-xs font-bold text-slate-200">
                  🏆 {categoriaText}
                </span>
                {profile.genero && (
                  <span className="bg-white/10 px-3 py-1 rounded-full border border-white/15 text-xs font-bold text-slate-200">
                    {generoText}
                  </span>
                )}
              </div>
            </div>

            {/* Grid privado: se excluyen email y teléfono */}
            <div className="grid grid-cols-2 gap-2.5 my-4">

              {/* Posición */}
              <div className="bg-white/5 border border-white/10 p-3 rounded-2xl">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">
                  Posición
                </span>
                <span className="text-xs font-extrabold text-white">
                  {posicionText}
                </span>
              </div>

              {/* Mano Dominante */}
              <div className="bg-white/5 border border-white/10 p-3 rounded-2xl">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">
                  Mano dominante
                </span>
                <span className="text-xs font-extrabold text-white">
                  {manoText}
                </span>
              </div>

              {/* Dónde juego habitualmente */}
              <div className="bg-white/5 border border-white/10 p-3 rounded-2xl col-span-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">
                  Clubes habituales
                </span>
                <span className="text-xs font-extrabold text-emerald-400">
                  📍 {clubesText}
                </span>
              </div>
            </div>

            {/* Stats Bar */}
            <div className="flex justify-around items-center bg-white/5 border border-white/10 rounded-2xl py-2.5 px-2 mb-4 text-center">
              <div>
                <div className="text-base font-black text-[#D9F23B]">{partidosContador}</div>
                <div className="text-[10px] font-medium text-slate-300">Partidos MatchGo</div>
              </div>
              <div className="h-6 w-[1px] bg-white/10" />
              <div>
                <div className="text-base font-black text-[#39C54A]">100%</div>
                <div className="text-[10px] font-medium text-slate-300">Comunidad</div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col gap-2 pt-2">
            <button
              onClick={handleWhatsApp}
              className="w-full bg-[#25D366] hover:bg-[#20bd5a] text-[#0B1F4D] font-extrabold py-3 px-4 rounded-2xl flex items-center justify-center gap-2 transition active:scale-[0.98] shadow-lg text-sm"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.299.38 2.51 1.036 3.531l-.678 2.473 2.539-.666c.983.535 2.1.84 3.27.84h.001c3.181 0 5.768-2.586 5.768-5.766 0-3.18-2.587-5.765-5.768-5.765zm3.385 8.131c-.144.405-.837.774-1.17.822-.312.043-.717.073-2.052-.472-1.603-.654-2.617-2.278-2.696-2.383-.079-.105-.648-.863-.648-1.647 0-.783.41-1.168.557-1.325.147-.157.321-.196.427-.196.105 0 .21.001.301.005.097.004.228-.037.356.27.13.31.442 1.08.481 1.158.039.078.065.17.013.273-.052.105-.078.17-.156.262-.078.092-.163.205-.233.275-.078.078-.16.163-.069.319.091.156.405.669.87 1.083.598.533 1.103.698 1.259.776.156.078.247.065.339-.039.091-.105.391-.456.495-.613.105-.157.21-.131.353-.078.144.052.912.43 1.069.508.156.078.261.117.3.183.039.066.039.38-.105.785z"/>
              </svg>
              Compartir por WhatsApp
            </button>

            <div className="flex gap-2">
              <button
                onClick={handleCopiar}
                className="flex-1 bg-white/10 hover:bg-white/15 text-white font-bold py-2.5 px-3 rounded-2xl flex items-center justify-center gap-2 transition active:scale-[0.98] text-xs border border-white/15"
              >
                {copied ? '✓ ¡Copiado!' : '📋 Copiar ficha'}
              </button>

              {'share' in navigator && (
                <button
                  onClick={handleNativeShare}
                  className="flex-1 bg-[#D9F23B] hover:bg-[#c9e22b] text-[#0B1F4D] font-extrabold py-2.5 px-3 rounded-2xl flex items-center justify-center gap-2 transition active:scale-[0.98] text-xs"
                >
                  🚀 Más opciones
                </button>
              )}
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
