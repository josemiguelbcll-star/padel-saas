import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  User,
  Calendar,
  Trophy,
  LogOut,
  ChevronDown,
  Shield,
  LogIn
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { usePlayerProfile } from '@/features/player/hooks/usePlayerProfile';
import { useNotificaciones } from '@/features/player/hooks/useNotificaciones';

export function PlayerNavDropdown() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Perfil del jugador y notificaciones (React Query)
  const { profile } = usePlayerProfile();
  const { unreadCount = 0 } = useNotificaciones();

  // Estado de sesión real de auth
  const [sessionUser, setSessionUser] = useState<any>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSessionUser(session?.user ?? null);
      setIsCheckingAuth(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionUser(session?.user ?? null);
      setIsCheckingAuth(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Cerrar dropdown al hacer click afuera
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Si no está logueado, mostramos el botón de Ingresar
  if (!isCheckingAuth && !sessionUser) {
    return (
      <Link
        to="/player"
        className="flex items-center gap-2 pl-2 pr-4 py-1.5 rounded-full bg-white hover:bg-slate-50 border border-slate-200/90 shadow-sm hover:shadow transition-all duration-200 text-slate-800 font-semibold text-xs sm:text-sm cursor-pointer"
      >
        <div className="w-8 h-8 rounded-full bg-[#E8EEF5] text-slate-600 flex items-center justify-center font-bold text-sm">
          <LogIn className="w-4 h-4 text-emerald-600" />
        </div>
        <span>Ingresar como jugador</span>
      </Link>
    );
  }

  // Nombre y datos del jugador autenticado
  const displayName =
    profile?.nombre?.trim() ||
    sessionUser?.user_metadata?.nombre ||
    sessionUser?.email?.split('@')[0] ||
    'Mi Cuenta';

  const displayAvatar = profile?.avatar_url || null;
  const displayEmail = profile?.email || sessionUser?.email || '';
  const displayCategory = profile?.categoria ? `${profile.categoria} Categoría` : 'Jugador';

  const handleLogout = async () => {
    setIsOpen(false);
    try {
      await supabase.auth.signOut();
      queryClient.clear();
      setSessionUser(null);
      navigate('/');
    } catch (e) {
      console.error('Error al cerrar sesión:', e);
    }
  };

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      {/* Botón de Perfil con Avatar y Badge (Estilo idéntico a la captura) */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-3 pl-1.5 pr-4 py-1 rounded-full bg-white hover:bg-slate-50 border border-slate-200/90 shadow-sm hover:shadow transition-all duration-200 cursor-pointer group"
      >
        {/* Avatar Circular con Badge */}
        <div className="relative flex-shrink-0">
          {displayAvatar ? (
            <img
              src={displayAvatar}
              alt={displayName}
              className="w-9 h-9 rounded-full object-cover ring-2 ring-slate-200"
            />
          ) : (
            <div className="w-9 h-9 rounded-full bg-[#E8EEF5] text-slate-600 flex items-center justify-center font-bold text-sm ring-2 ring-slate-200">
              <User className="w-5 h-5 text-slate-500" />
            </div>
          )}
          
          {/* Badge de Notificación si hay */}
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-[#00B050] text-white text-[10px] font-black rounded-full flex items-center justify-center shadow-sm border-2 border-white z-10">
              {unreadCount}
            </span>
          )}
        </div>

        {/* Nombre del Jugador */}
        <span className="text-xs sm:text-sm font-semibold text-slate-800 tracking-tight">
          {displayName}
        </span>

        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${
            isOpen ? 'rotate-180 text-emerald-600' : 'group-hover:text-slate-600'
          }`}
        />
      </button>

      {/* Menú Desplegable (Dropdown) */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 sm:w-80 rounded-2xl bg-white shadow-2xl border border-slate-100 ring-1 ring-black/5 z-50 overflow-hidden animate-in fade-in-50 zoom-in-95 duration-150">
          {/* Cabecera del Perfil con Foto y Detalles */}
          <div className="p-4 bg-gradient-to-br from-slate-900 to-slate-800 text-white relative">
            <div className="flex items-center gap-3">
              {displayAvatar ? (
                <img
                  src={displayAvatar}
                  alt={displayName}
                  className="w-12 h-12 rounded-full object-cover border-2 border-[#00FF87]/60 shadow"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#D9F23B] to-[#39C54A] text-[#0B1F4D] flex items-center justify-center font-extrabold text-base border-2 border-white/40 shadow">
                  {displayName.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <h4 className="text-sm font-bold text-white truncate">{displayName}</h4>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-[#00A859]/30 text-[#00FF87] border border-[#00FF87]/30 uppercase">
                    Jugador
                  </span>
                </div>
                {displayEmail && <p className="text-xs text-slate-300 truncate">{displayEmail}</p>}
                <p className="text-[11px] text-[#00FF87] font-semibold mt-0.5">{displayCategory}</p>
              </div>
            </div>
          </div>

          {/* Menú de Acciones Rápidas con rutas reales a cada pestaña */}
          <div className="p-2 space-y-1">
            <Link
              to="/player/partidos"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-emerald-600 transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <Calendar className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-slate-800">Mis Reservas y Turnos</p>
                <p className="text-[11px] text-slate-500">Historial y próximos partidos</p>
              </div>
            </Link>

            <Link
              to="/player/jugar"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-emerald-600 transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                <Trophy className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-slate-800">Partidos & Desafíos</p>
                <p className="text-[11px] text-slate-500">Sumate a partidos abiertos</p>
              </div>
            </Link>

            <Link
              to="/player/perfil"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-emerald-600 transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                <User className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-slate-800">Mi Perfil y Preferencias</p>
                <p className="text-[11px] text-slate-500">Categoría, posición y datos</p>
              </div>
            </Link>
          </div>

          {/* Footer del Dropdown con Logout Real y Funcional */}
          <div className="p-2 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <Link
              to="/login"
              onClick={() => setIsOpen(false)}
              className="text-[11px] font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1.5 px-2 py-1"
            >
              <Shield className="w-3.5 h-3.5 text-slate-400" />
              Panel de Clubes
            </Link>

            <button
              type="button"
              onClick={handleLogout}
              className="text-[11px] font-bold text-rose-600 hover:text-rose-700 flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-rose-50 transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              Cerrar sesión
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
