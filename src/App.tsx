import type { ReactNode } from 'react';
import { Navigate, Routes, Route } from 'react-router-dom';
import { LoginPage, ProtectedRoute, useSession } from '@/features/auth';
import { AppShell } from '@/components/layout/AppShell';
import { DashboardPage } from '@/pages/DashboardPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import {
  ConfiguracionLayout,
  MarcaPage,
  UsuariosPage,
  CanchasPage,
  HorariosPage,
  TarifasConfigPage,
  ProfesoresPage,
  ClasesPage,
  ProductosPage,
  ProveedoresPage,
  UnidadesPage,
  CategoriasGastoPage,
  TesoreriaPage,
  PerfilPublicoPage,
} from '@/features/configuracion';
import { BuffetPage } from '@/features/buffet';
import { CajaLayout, CajaPage, TransferenciasPage } from '@/features/caja';
import {
  FinanzasPage,
  GastosPage,
  OtrosIngresosPage,
  CuentasPorPagarPage,
  FlujoCajaPage,
} from '@/features/finanzas';
import { JugadoresPage } from '@/features/jugadores';
import { OnboardingGate, OnboardingPage } from '@/features/onboarding';
import {
  PlataformaProtectedRoute,
  PlataformaPage,
} from '@/features/plataforma';
import { InventarioPage } from '@/features/inventario';
import { ReservasPage } from '@/features/reservas';
import { TurnosFijosPage } from '@/features/turnos-fijos';
import { LandingPage, ClubProfilePage } from '@/features/landing';
import { DesafiosPrototype } from '@/features/desafios';
import { PlayerApp } from '@/features/player/PlayerApp';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/club/:slug" element={<ClubProfilePage />} />
      <Route path="/prototipo/desafios" element={<DesafiosPrototype />} />
      <Route path="/player" element={<PlayerApp />} />
      <Route path="/login" element={<LoginPage />} />

      {/* Panel de plataforma (superadmin del SaaS). Va FUERA del
          ProtectedRoute del club: el superadmin no tiene club. Su
          propio guard (PlataformaProtectedRoute) requiere
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
