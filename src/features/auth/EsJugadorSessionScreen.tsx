import { Link, useNavigate } from 'react-router-dom';
import { Trophy, LogOut, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSession } from './useSession';

interface EsJugadorSessionScreenProps {
  email?: string;
  nombre?: string;
}

/**
 * Pantalla informativa y amigable que se muestra cuando un usuario con sesión
 * de Jugador (B2C) intenta acceder a /login o a las rutas protegidas del
 * software de gestión de clubes (/app).
 *
 * En lugar de un error técnico genérico (NO_USUARIO_ROW), le ofrece navegación
 * directa a su app de jugador o cerrar sesión para ingresar con cuenta de club.
 */
export function EsJugadorSessionScreen({ email, nombre }: EsJugadorSessionScreenProps) {
  const { signOut } = useSession();
  const navigate = useNavigate();

  const displayName = nombre?.trim() || email || 'Jugador';

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 sm:p-6">
      <div className="w-full max-w-md space-y-6 rounded-2xl border bg-card p-6 sm:p-8 shadow-lg text-center">
        {/* Logo MatchGo */}
        <div className="flex justify-center">
          <img
            src="/matchgo_logo.svg"
            alt="MatchGo"
            className="h-10 sm:h-12 w-auto object-contain"
          />
        </div>

        {/* Badge & Avatar de Jugador */}
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#D9F23B] to-[#39C54A] flex items-center justify-center shadow-md">
              <Trophy className="w-8 h-8 text-[#0B1F4D]" />
            </div>
            <span className="absolute -bottom-1 -right-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-[#00B050] text-white uppercase tracking-wider shadow">
              Jugador
            </span>
          </div>

          <div className="space-y-1">
            <h1 className="text-xl font-bold text-foreground">
              Estás conectado como Jugador
            </h1>
            <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
              {displayName}
            </p>
          </div>
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed">
          Tu cuenta actual está configurada para reservar canchas y jugar partidos. El panel de gestión del software es exclusivo para administradores y staff de clubes de pádel.
        </p>

        {/* Acciones principales */}
        <div className="space-y-3 pt-2">
          <Button
            onClick={() => navigate('/player')}
            className="w-full bg-[#00B050] hover:bg-[#009243] text-white font-bold py-2.5 shadow-sm hover:shadow transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <span>Ir a mi App de Jugador</span>
            <ArrowRight className="w-4 h-4" />
          </Button>

          <Button
            variant="outline"
            onClick={() => {
              void signOut();
            }}
            className="w-full border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogOut className="w-4 h-4 text-slate-500" />
            <span>Cerrar sesión e ingresar como Club</span>
          </Button>
        </div>

        <div className="pt-2">
          <Link
            to="/"
            className="text-xs text-muted-foreground hover:text-foreground transition underline underline-offset-4"
          >
            Volver a la página principal
          </Link>
        </div>
      </div>
    </div>
  );
}
