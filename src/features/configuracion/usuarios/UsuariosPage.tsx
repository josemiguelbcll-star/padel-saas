import { useMemo, useState } from 'react';
import { Pencil, Plus, ShieldCheck, UserX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSession } from '@/features/auth';
import { useUsuariosClub } from '@/features/configuracion/hooks/useUsuariosClub';
import type { Usuario } from '@/types/database';
import { NuevoVendedorDialog } from './NuevoVendedorDialog';
import { EditarUsuarioDialog } from './EditarUsuarioDialog';

const fechaFmt = new Intl.DateTimeFormat('es-AR', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function fmtFecha(iso: string): string {
  return fechaFmt.format(new Date(iso));
}

function rolLabel(rol: 'admin' | 'vendedor'): string {
  return rol === 'admin' ? 'Admin' : 'Vendedor';
}

/**
 * Pantalla "Usuarios" del módulo Configuración. Lista los usuarios
 * del club y permite al admin crear/editar/desactivar.
 *
 * Permisos:
 *   - Cualquier usuario del club puede VER la lista (la policy
 *     `usuarios_select` de 0001/0002 lo permite).
 *   - Solo admin puede crear / editar / desactivar. Los botones se
 *     ocultan para vendedores; el server-side los rechazaría igual.
 *
 * Regla del último admin (0018):
 *   - El trigger `tr_proteger_ultimo_admin_activo` bloquea cualquier
 *     UPDATE que dejaría al club sin admin activo. Acá calculamos
 *     `esUltimoAdminActivo` por fila para ocultar las opciones que el
 *     trigger rechazaría — mejor UX.
 */
export function UsuariosPage() {
  const { user: yo } = useSession();
  const isAdmin = yo?.rol === 'admin';

  const query = useUsuariosClub();

  const [nuevoOpen, setNuevoOpen] = useState(false);
  const [editandoUsuario, setEditandoUsuario] = useState<Usuario | null>(null);

  const usuarios = useMemo<Usuario[]>(() => query.data ?? [], [query.data]);

  // Cantidad de admin activos del club. Usado para calcular si una
  // fila es el "último admin" — el trigger del 0018 bloquea
  // desactivar/degradar al último, así que ocultamos esas opciones.
  const cantidadAdminActivos = useMemo(
    () => usuarios.filter((u) => u.rol === 'admin' && u.activo).length,
    [usuarios],
  );

  function esUltimoAdminActivo(u: Usuario): boolean {
    return (
      u.rol === 'admin' &&
      u.activo &&
      cantidadAdminActivos === 1
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-foreground">Usuarios</h1>
          <p className="text-sm text-muted-foreground">
            Gestioná los vendedores y admins del club. Los usuarios
            desactivados no pueden iniciar sesión.
          </p>
        </div>
        {isAdmin && (
          <Button
            type="button"
            onClick={() => setNuevoOpen(true)}
            className="shrink-0"
          >
            <Plus className="h-4 w-4" />
            Nuevo vendedor
          </Button>
        )}
      </header>

      {!isAdmin && (
        <div
          role="status"
          className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
        >
          Solo el administrador del club puede crear o editar usuarios.
          Podés ver la lista pero no modificarla.
        </div>
      )}

      {query.isLoading ? (
        <div className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
          Cargando usuarios…
        </div>
      ) : query.error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {query.error.message}
        </div>
      ) : usuarios.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No hay usuarios en el club.
          </p>
        </div>
      ) : (
        <UsuariosTabla
          usuarios={usuarios}
          yoId={yo?.id ?? null}
          isAdmin={isAdmin}
          onEditar={(u) => setEditandoUsuario(u)}
          esUltimoAdminActivo={esUltimoAdminActivo}
        />
      )}

      <NuevoVendedorDialog open={nuevoOpen} onOpenChange={setNuevoOpen} />

      {editandoUsuario && (
        <EditarUsuarioDialog
          open={editandoUsuario !== null}
          onOpenChange={(next) => {
            if (!next) setEditandoUsuario(null);
          }}
          usuario={editandoUsuario}
          esUltimoAdminActivo={esUltimoAdminActivo(editandoUsuario)}
          esYo={editandoUsuario.id === yo?.id}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tabla de usuarios
// ─────────────────────────────────────────────────────────────────────

interface UsuariosTablaProps {
  usuarios: Usuario[];
  yoId: string | null;
  isAdmin: boolean;
  onEditar: (u: Usuario) => void;
  esUltimoAdminActivo: (u: Usuario) => boolean;
}

function UsuariosTabla({
  usuarios,
  yoId,
  isAdmin,
  onEditar,
  esUltimoAdminActivo,
}: UsuariosTablaProps) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2 font-medium">Nombre</th>
            <th className="px-3 py-2 font-medium">Email</th>
            <th className="px-3 py-2 font-medium">Rol</th>
            <th className="px-3 py-2 font-medium">Estado</th>
            <th className="px-3 py-2 font-medium">Alta</th>
            {isAdmin && (
              <th className="w-1 px-3 py-2 text-right font-medium">
                <span className="sr-only">Acciones</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {usuarios.map((u) => {
            const esYo = u.id === yoId;
            const ultimoAdmin = esUltimoAdminActivo(u);
            return (
              <tr
                key={u.id}
                className={cn(
                  'border-b border-border last:border-b-0 transition-colors',
                  !u.activo && 'bg-muted/20',
                )}
              >
                <td
                  className={cn(
                    'px-3 py-3 font-medium',
                    u.activo ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    {u.nombre}
                    {esYo && (
                      <span className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                        (vos)
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-3 text-muted-foreground">
                  {u.email ?? <span className="italic">sin email</span>}
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1.5">
                    {u.rol === 'admin' && (
                      <ShieldCheck
                        className="h-3.5 w-3.5 text-muted-foreground"
                        aria-hidden="true"
                      />
                    )}
                    <span
                      className={cn(
                        u.activo ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {rolLabel(u.rol)}
                    </span>
                    {ultimoAdmin && (
                      <span
                        className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground"
                        title="Es el último admin activo del club — no se puede desactivar ni degradar."
                      >
                        · único
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-3">
                  {u.activo ? (
                    <span className="text-foreground">Activo</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <UserX className="h-3.5 w-3.5" aria-hidden="true" />
                      Inactivo
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 text-muted-foreground tabular-nums">
                  {fmtFecha(u.fecha_alta)}
                </td>
                {isAdmin && (
                  <td className="px-3 py-3">
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onEditar(u)}
                        aria-label={`Editar ${u.nombre}`}
                        title="Editar"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
