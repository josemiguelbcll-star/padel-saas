import { Routes, Route } from 'react-router-dom';
import { LoginPage, ProtectedRoute } from '@/features/auth';
import { AppShell } from '@/components/layout/AppShell';
import { DashboardPage } from '@/pages/DashboardPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

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
        <Route index element={<DashboardPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
