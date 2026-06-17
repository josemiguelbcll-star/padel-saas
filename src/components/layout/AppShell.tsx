import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Sidebar, SidebarBrand, SidebarNav } from './Sidebar';
import { Topbar } from './Topbar';

/**
 * Layout principal de la aplicación autenticada:
 * - Sidebar fijo a la izquierda en md+
 * - Drawer (Sheet) en mobile, accionado desde el botón ☰ del Topbar
 * - Topbar sticky con club, estado de caja, campana y avatar
 * - <Outlet /> renderiza la página activa
 */
export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);

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
        <Topbar onMenuClick={() => setMobileOpen(true)} />
        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
