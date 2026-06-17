import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSession } from '@/features/auth';
import { CajaEstadoBadge } from '@/features/caja';
import { getLogoClubUrl } from '@/lib/clubBrand';
import { useLiveNotifications } from '@/hooks/useLiveNotifications';

interface TopbarProps {
  onMenuClick: () => void;
}

function initials(nombre: string): string {
  const parts = nombre.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';
  const result = (first + last).toUpperCase();
  return result || '?';
}

function rolLabel(rol: 'admin' | 'vendedor' | undefined): string {
  if (rol === 'admin') return 'Administrador';
  if (rol === 'vendedor') return 'Vendedor';
  return '—';
}

export function Topbar({ onMenuClick }: TopbarProps) {
  const { user, club, signOut } = useSession();
  const { notifications, unreadCount, markAllAsRead } = useLiveNotifications();

  // Logo: si el path falla cargar (archivo borrado, network, path
  // stale tras un cleanup parcial), caemos elegante a "solo nombre"
  // vía el onError del <img>. Cuando el path cambia (admin subió uno
  // nuevo), reseteamos el flag para que la imagen nueva tenga su
  // chance — un fallo anterior no debe bloquear un logo nuevo.
  const logoUrl = getLogoClubUrl(club?.logo_path ?? null);
  const [logoError, setLogoError] = useState(false);
  useEffect(() => {
    setLogoError(false);
  }, [club?.logo_path]);
  const muestraLogo = !!logoUrl && !logoError;

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:px-6">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={onMenuClick}
        aria-label="Abrir menú"
      >
        <Menu className="h-5 w-5" />
      </Button>

      {/* Identidad del club: logo (si existe) + nombre.
          El logo cae al fallback "solo nombre" si la imagen falla
          cargar (archivo borrado, path stale, network). El `key` sobre
          el <img> resetea el state de error cuando el path cambia —
          un logo nuevo siempre tiene una nueva chance. */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {muestraLogo && (
          <img
            key={club?.logo_path ?? ''}
            src={logoUrl ?? ''}
            alt={`Logo de ${club?.nombre ?? 'el club'}`}
            onError={() => setLogoError(true)}
            className="h-7 w-7 shrink-0 rounded object-contain"
          />
        )}
        <span className="truncate text-base font-semibold text-foreground">
          {club?.nombre ?? '—'}
        </span>
      </div>

      {/* Estado de caja — lee el estado real (useCajaAbierta) y linkea a /caja. */}
      <CajaEstadoBadge />

      {/* Campanita de Alarmas / Notificaciones */}
      <DropdownMenu onOpenChange={(open) => { if (open) markAllAsRead(); }}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="relative rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label="Notificaciones"
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute right-1.5 top-1.5 flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500"></span>
              </span>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80 p-2">
          <DropdownMenuLabel className="flex items-center justify-between px-2 py-1.5 text-xs font-semibold">
            <span>Notificaciones de reservas</span>
            {unreadCount > 0 && (
              <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
                {unreadCount} nuevas
              </span>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          
          <div className="max-h-64 overflow-y-auto py-1">
            {notifications.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                No hay notificaciones recientes
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={cn(
                    "flex flex-col gap-0.5 rounded-md px-2 py-2 text-xs transition-colors hover:bg-muted/50",
                    !n.read && "bg-primary/5 font-medium"
                  )}
                >
                  <div className="flex items-center justify-between text-foreground">
                    <span className="font-semibold truncate max-w-[170px]">
                      {n.jugadorNombre}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {n.horaInicio.slice(0, 5)} hs ({n.fecha.split('-').reverse().slice(0, 2).join('/')})
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Reservó la cancha <span className="font-medium text-foreground">{n.canchaNombre}</span>
                  </div>
                </div>
              ))
            )}
          </div>
          
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild className="cursor-pointer justify-center text-center text-xs text-primary font-medium hover:bg-primary/5 focus:bg-primary/5">
            <Link to="/app/reservas">Ver todas las reservas</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label="Menú de usuario"
          >
            <Avatar className="h-9 w-9">
              <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                {user ? initials(user.nombre) : '?'}
              </AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col">
              <span className="text-sm font-medium text-foreground">
                {user?.nombre ?? '—'}
              </span>
              <span className="text-xs text-muted-foreground">
                {rolLabel(user?.rol)}
              </span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              void signOut();
            }}
          >
            Cerrar sesión
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
