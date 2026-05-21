import { Navigate, Routes, Route } from 'react-router-dom';
import { LoginPage, ProtectedRoute } from '@/features/auth';
import { AppShell } from '@/components/layout/AppShell';
import { DashboardPage } from '@/pages/DashboardPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import {
  ConfiguracionLayout,
  CanchasPage,
  HorariosPage,
  TarifasPage,
  ProfesoresPage,
  ClasesPage,
  ProductosPage,
} from '@/features/configuracion';
import { BuffetPage } from '@/features/buffet';
import { JugadoresPage } from '@/features/jugadores';
import { OnboardingGate, OnboardingPage } from '@/features/onboarding';
import { ReservasPage } from '@/features/reservas';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/* Todo lo que cuelga de "/" está detrás de ProtectedRoute + AppShell.
          ProtectedRoute redirige a /login si no hay sesión y muestra
          pantallas dedicadas para NO_USUARIO_ROW y FETCH_FAILED. */}
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

        <Route path="configuracion" element={<ConfiguracionLayout />}>
          <Route index element={<Navigate to="canchas" replace />} />
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
