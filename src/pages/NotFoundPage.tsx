/**
 * Catch-all dentro del shell autenticado. Aparece si el usuario navega
 * manualmente a una ruta de un módulo todavía deshabilitado (ej. /reservas).
 */
export function NotFoundPage() {
  return (
    <div className="flex flex-1 items-center justify-center p-12">
      <div className="max-w-md space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Sección no disponible
        </h1>
        <p className="text-sm text-muted-foreground">
          Esta página todavía no está implementada en esta versión del SaaS.
        </p>
      </div>
    </div>
  );
}
