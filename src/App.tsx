import type { ReactNode } from 'react';
import { lazy, Suspense } from 'react';
import { Navigate, Routes, Route } from 'react-router-dom';
import { LoginPage } from '@/features/auth/LoginPage';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { useSession } from '@/features/auth/useSession';
import { AppShell } from '@/components/layout/AppShell';
import { LandingPage, ClubProfilePage } from '@/features/landing';
import { PlayerApp } from '@/features/player/PlayerApp';
import { DesafiosPrototype } from '@/features/desafios';
import { OnboardingGate } from '@/features/onboarding/OnboardingGate';
import { PlataformaProtectedRoute } from '@/features/plataforma/PlataformaProtectedRoute';

// Lazy-loaded pages
const DashboardPage = lazy(() => import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));
const OnboardingPage = lazy(() => import('@/features/onboarding/OnboardingPage').then((m) => ({ default: m.OnboardingPage })));
const ReservasPage = lazy(() => import('@/features/reservas/ReservasPage').then((m) => ({ default: m.ReservasPage })));
const TurnosFijosPage = lazy(() => import('@/features/turnos-fijos/TurnosFijosPage').then((m) => ({ default: m.TurnosFijosPage })));
const InventarioPage = lazy(() => import('@/features/inventario/InventarioPage').then((m) => ({ default: m.InventarioPage })));
const JugadoresPage = lazy(() => import('@/features/jugadores/JugadoresPage').then((m) => ({ default: m.JugadoresPage })));
const NoticiasPage = lazy(() => import('@/features/admin/pages/NoticiasPage').then((m) => ({ default: m.NoticiasPage })));
const BuffetPage = lazy(() => import('@/features/buffet/BuffetPage').then((m) => ({ default: m.BuffetPage })));
const CajaLayout = lazy(() => import('@/features/caja/CajaLayout').then((m) => ({ default: m.CajaLayout })));
const CajaPage = lazy(() => import('@/features/caja/CajaPage').then((m) => ({ default: m.CajaPage })));
const TransferenciasPage = lazy(() => import('@/features/caja/TransferenciasPage').then((m) => ({ default: m.TransferenciasPage })));
const FinanzasPage = lazy(() => import('@/features/finanzas/FinanzasPage').then((m) => ({ default: m.FinanzasPage })));
const FlujoCajaPage = lazy(() => import('@/features/finanzas/flujo/FlujoCajaPage').then((m) => ({ default: m.FlujoCajaPage })));
const GastosPage = lazy(() => import('@/features/finanzas/GastosPage').then((m) => ({ default: m.GastosPage })));
const OtrosIngresosPage = lazy(() => import('@/features/finanzas/OtrosIngresosPage').then((m) => ({ default: m.OtrosIngresosPage })));
const CuentasPorPagarPage = lazy(() => import('@/features/finanzas/CuentasPorPagarPage').then((m) => ({ default: m.CuentasPorPagarPage })));
const PlataformaPage = lazy(() => import('@/features/plataforma/PlataformaPage').then((m) => ({ default: m.PlataformaPage })));

// Config layout & subpages
const ConfiguracionLayout = lazy(() => import('@/features/configuracion/ConfiguracionLayout').then((m) => ({ default: m.ConfiguracionLayout })));
const MarcaPage = lazy(() => import('@/features/configuracion/marca/MarcaPage').then((m) => ({ default: m.MarcaPage })));
const UsuariosPage = lazy(() => import('@/features/configuracion/usuarios/UsuariosPage').then((m) => ({ default: m.UsuariosPage })));
const CanchasPage = lazy(() => import('@/features/configuracion/canchas/CanchasPage').then((m) => ({ default: m.CanchasPage })));
const HorariosPage = lazy(() => import('@/features/configuracion/horarios/HorariosPage').then((m) => ({ default: m.HorariosPage })));
const TarifasConfigPage = lazy(() => import('@/features/configuracion/tarifas/TarifasConfigPage').then((m) => ({ default: m.TarifasConfigPage })));
const ProfesoresPage = lazy(() => import('@/features/configuracion/profesores/ProfesoresPage').then((m) => ({ default: m.ProfesoresPage })));
const ClasesPage = lazy(() => import('@/features/configuracion/clases/ClasesPage').then((m) => ({ default: m.ClasesPage })));
const ProductosPage = lazy(() => import('@/features/configuracion/productos/ProductosPage').then((m) => ({ default: m.ProductosPage })));
const ProveedoresPage = lazy(() => import('@/features/configuracion/proveedores/ProveedoresPage').then((m) => ({ default: m.ProveedoresPage })));
const UnidadesPage = lazy(() => import('@/features/configuracion/finanzas/UnidadesPage').then((m) => ({ default: m.UnidadesPage })));
const CategoriasGastoPage = lazy(() => import('@/features/configuracion/finanzas/CategoriasGastoPage').then((m) => ({ default: m.CategoriasGastoPage })));
const TesoreriaPage = lazy(() => import('@/features/configuracion/tesoreria/TesoreriaPage').then((m) => ({ default: m.TesoreriaPage })));
const PerfilPublicoPage = lazy(() => import('@/features/configuracion/perfil-publico/PerfilPublicoPage').then((m) => ({ default: m.PerfilPublicoPage })));

export function App() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
          Cargando…
        </div>
      }
    >
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/club/:slug" element={<ClubProfilePage />} />
        <Route path="/prototipo/desafios" element={<DesafiosPrototype />} />
        <Route path="/player/*" element={<PlayerApp />} />
        <Route path="/login" element={<LoginPage />} />

        {/* Panel de plataforma (superadmin del SaaS). Va FUERA del
            ProtectedRoute del club: el superadmin no tiene club. Su
            propio guard (PlataformaProtectedRoute) requires
            plataformaAdmin !== null; si un admin de club entra por
            URL, lo redirige a "/". Si nadie tiene sesión, a "/login".
            Anti-loop: ProtectedRoute del club redirige el superadmin
            acá, este guard lo deja entrar. */}
        <Route
          path="/plataforma"
          element={
            <PlataformaProtectedRoute>
              <PlataformaPage />
            </PlataformaProtectedRoute>
          }
        />

        {/* Todo lo que cuelga de "/" está detrás de ProtectedRoute + AppShell.
            ProtectedRoute redirige a /login si no hay sesión y muestra
            pantallas dedicadas para NO_USUARIO_ROW y FETCH_FAILED.
            Si el caller es superadmin, redirige a /plataforma. */}
        <Route
          path="/app"
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route
            index
            element={
              <OnboardingGate>
                <DashboardPage />
              </OnboardingGate>
            }
          />

          <Route path="onboarding" element={<OnboardingPage />} />

          <Route path="reservas" element={<ReservasPage />} />
          <Route path="turnos-fijos" element={<TurnosFijosPage />} />

          <Route path="inventario" element={<AdminOnlyRoute><InventarioPage /></AdminOnlyRoute>} />

          <Route path="jugadores" element={<JugadoresPage />} />

          <Route path="noticias" element={<NoticiasPage />} />

          <Route path="buffet" element={<BuffetPage />} />

          <Route path="caja" element={<CajaLayout />}>
            <Route index element={<Navigate to="/app/caja/efectivo" replace />} />
            <Route path="efectivo" element={<CajaPage />} />
            <Route path="transferencias" element={<TransferenciasPage />} />
          </Route>

          <Route path="finanzas" element={<FinanzasPage />} />
          <Route path="flujo-caja" element={<FlujoCajaPage />} />
          <Route path="gastos" element={<GastosPage />} />
          <Route path="otros-ingresos" element={<OtrosIngresosPage />} />
          <Route path="cxp" element={<CuentasPorPagarPage />} />

          <Route path="configuracion" element={<ConfiguracionLayout />}>
            <Route index element={<Navigate to="marca" replace />} />
            <Route path="marca" element={<MarcaPage />} />
            <Route path="usuarios" element={<UsuariosPage />} />
            <Route path="canchas" element={<CanchasPage />} />
            <Route path="horarios" element={<HorariosPage />} />
            <Route path="tarifas" element={<TarifasConfigPage />} />
            <Route path="profesores" element={<ProfesoresPage />} />
            <Route path="clases" element={<ClasesPage />} />
            <Route path="productos" element={<ProductosPage />} />
            <Route path="proveedores" element={<ProveedoresPage />} />
            <Route path="unidades" element={<UnidadesPage />} />
            <Route path="categorias-gasto" element={<CategoriasGastoPage />} />
            <Route path="cuentas" element={<TesoreriaPage />} />
            <Route path="perfil-publico" element={<AdminOnlyRoute><PerfilPublicoPage /></AdminOnlyRoute>} />
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

/**
 * Gate de rol para rutas admin-only (ej. /inventario). Si el caller no
 * es admin, redirige a "/" (el sidebar también esconde el item; este
 * gate es la red de seguridad para acceso directo por URL). La
 * seguridad real es server-side (RLS + RPC gates).
 */
function AdminOnlyRoute({ children }: { children: ReactNode }) {
  const { user } = useSession();
  if (user?.rol !== 'admin') {
    return <Navigate to="/app" replace />;
  }
  return <>{children}</>;
}
