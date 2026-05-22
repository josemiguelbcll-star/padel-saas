import { useEffect, useState } from 'react';
import { Bell, Menu } from 'lucide-react';
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
import { getLogoClubUrl } from '@/lib/clubBrand';

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

      {/* Placeholder de estado de caja — se va a alimentar desde el módulo
          Caja en el próximo sprint. */}
      <div
        className="hidden items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground sm:inline-flex"
        aria-label="Estado de caja"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" aria-hidden="true" />
        Caja: cerrada
      </div>

      {/* Campana de alarmas — placeholder con contador 0 hasta que exista
          el módulo Alarmas. */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="relative"
        aria-label="Alarmas (0 pendientes)"
        disabled
      >
        <Bell className="h-5 w-5" />
        <span className="absolute right-1 top-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-muted px-1 text-[10px] font-medium text-muted-foreground">
          0
        </span>
      </Button>

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
