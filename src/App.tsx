import { Navigate, Routes, Route } from 'react-router-dom';
import { LoginPage, ProtectedRoute } from '@/features/auth';
import { AppShell } from '@/components/layout/AppShell';
import { DashboardPage } from '@/pages/DashboardPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import {
  ConfiguracionLayout,
  MarcaPage,
  UsuariosPage,
  CanchasPage,
  HorariosPage,
  TarifasPage,
  ProfesoresPage,
  ClasesPage,
  ProductosPage,
} from '@/features/configuracion';
import { BuffetPage } from '@/features/buffet';
import { CajaPage } from '@/features/caja';
import { JugadoresPage } from '@/features/jugadores';
import { OnboardingGate, OnboardingPage } from '@/features/onboarding';
import {
  PlataformaProtectedRoute,
  PlataformaPage,
} from '@/features/plataforma';
import { ReservasPage } from '@/features/reservas';

export function App() {
  return (
    <Routes>
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
        path="/"
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

        <Route path="jugadores" element={<JugadoresPage />} />

        <Route path="buffet" element={<BuffetPage />} />

        <Route path="caja" element={<CajaPage />} />

        <Route path="configuracion" element={<ConfiguracionLayout />}>
          <Route index element={<Navigate to="marca" replace />} />
          <Route path="marca" element={<MarcaPage />} />
          <Route path="usuarios" element={<UsuariosPage />} />
          <Route path="canchas" element={<CanchasPage />} />
          <Route path="horarios" element={<HorariosPage />} />
          <Route path="tarifas" element={<TarifasPage />} />
          <Route path="profesores" element={<ProfesoresPage />} />
          <Route path="clases" element={<ClasesPage />} />
          <Route path="productos" element={<ProductosPage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
