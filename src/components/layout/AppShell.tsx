import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useSession } from '@/features/auth/useSession';
import { Sidebar, SidebarBrand, SidebarNav } from './Sidebar';
import { Topbar } from './Topbar';

/**
 * Layout principal de la aplicación autenticada:
 * - Sidebar fijo a la izquierda en md+
 * - Drawer (Sheet) en mobile, accionado desde el botón ☰ del Topbar
 * - Banner persistente si el superadmin está impersonando un club
 * - Topbar sticky con club, estado de caja, campana y avatar
 * - <Outlet /> renderiza la página activa
 */
export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isImpersonating, club, stopImpersonating } = useSession();
  const navigate = useNavigate();

  const handleVolverPlataforma = async () => {
    await stopImpersonating();
    navigate('/plataforma');
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Sidebar />

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 p-0 flex flex-col h-full">
          {/* Visually-hidden title para a11y del Radix Dialog */}
          <SheetTitle className="sr-only">Menú de navegación</SheetTitle>
          <SidebarBrand />
          <SidebarNav onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-h-screen flex-col md:pl-64">
        {isImpersonating && (
          <div className="sticky top-0 z-40 flex items-center justify-between border-b border-amber-500/30 bg-amber-500/15 px-4 py-2 text-xs backdrop-blur text-amber-950 dark:text-amber-200">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                Modo Superadmin: Administrando como{' '}
                <strong>{club?.nombre ?? 'Club'}</strong> (acceso total)
              </span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 border-amber-600/40 bg-amber-500/10 text-amber-950 hover:bg-amber-500/20 dark:text-amber-200 text-xs gap-1.5"
              onClick={() => {
                void handleVolverPlataforma();
              }}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Volver a Plataforma
            </Button>
          </div>
        )}

        <Topbar onMenuClick={() => setMobileOpen(true)} />
        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
