import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { navItems, type NavItem } from './navItems';

/**
 * Sidebar fijo de escritorio. En mobile (<md) no se renderiza y el
 * AppShell expone el mismo contenido (SidebarBrand + SidebarNav) dentro
 * de un drawer.
 */
export function Sidebar() {
  return (
    <aside className="hidden md:fixed md:inset-y-0 md:left-0 md:z-40 md:flex md:w-64 md:flex-col md:border-r md:border-border md:bg-card">
      <SidebarBrand />
      <SidebarNav />
    </aside>
  );
}

export function SidebarBrand() {
  return (
    <div className="flex h-14 items-center border-b border-border px-6">
      <span className="text-base font-semibold tracking-tight text-foreground">
        Padel SaaS
      </span>
    </div>
  );
}

interface SidebarNavProps {
  onNavigate?: () => void;
}

export function SidebarNav({ onNavigate }: SidebarNavProps) {
  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
      {navItems.map((item) => (
        <SidebarItem key={item.label} item={item} onNavigate={onNavigate} />
      ))}
    </nav>
  );
}

interface SidebarItemProps {
  item: NavItem;
  onNavigate?: () => void;
}

function SidebarItem({ item, onNavigate }: SidebarItemProps) {
  const Icon = item.icon;

  if (item.disabled) {
    return (
      <div
        role="link"
        aria-disabled="true"
        className="flex cursor-not-allowed select-none items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground/90"
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 truncate">{item.label}</span>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Próx.
        </span>
      </div>
    );
  }

  return (
    <NavLink
      to={item.to}
      end
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          isActive
            ? 'bg-primary/10 font-medium text-primary'
            : 'text-foreground hover:bg-muted',
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{item.label}</span>
    </NavLink>
  );
}
