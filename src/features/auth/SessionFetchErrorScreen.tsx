interface SessionFetchErrorScreenProps {
  detail: string;
}

/**
 * Pantalla de fallo al traer el perfil del usuario tras autenticarse.
 * Compartida entre ProtectedRoute y LoginPage para que el mensaje sea
 * idéntico en cualquier flujo donde el fetch del perfil falle.
 */
export function SessionFetchErrorScreen({ detail }: SessionFetchErrorScreenProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-sm">
        <h2 className="text-base font-semibold text-destructive">
          No pudimos cargar tu sesión
        </h2>
        <p className="text-muted-foreground">{detail}</p>
        <p className="text-muted-foreground">
          Refrescá la página o probá de nuevo en unos minutos.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="w-full rounded-md bg-destructive py-2 px-4 font-semibold text-white hover:bg-destructive/90 transition text-center"
        >
          Refrescar página
        </button>
      </div>
    </div>
  );
}
