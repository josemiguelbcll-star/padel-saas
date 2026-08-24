import { useState } from 'react';
import { UserPlus, CheckCircle, Clock, MessageCircle } from 'lucide-react';
import { useJugadorAmigos } from '../hooks/useJugadorAmigos';
import { supabase } from '@/lib/supabase';

interface AmigoItemProps {
  nombre: string;
  alias?: string | null;
  confirmado: boolean;
  onDesafiar?: () => void;
}

function AmigoItem({ nombre, alias, confirmado, onDesafiar }: AmigoItemProps) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3">
      {/* Avatar placeholder */}
      <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-400 to-green-400 flex items-center justify-center text-white text-xs font-bold">
        {nombre.charAt(0).toUpperCase()}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-gray-900 truncate">
          {alias ? `${alias} (@${nombre.split(' ')[0]})` : nombre}
        </p>
        <div className="flex items-center gap-1">
          {confirmado ? (
            <>
              <CheckCircle className="h-3 w-3 text-green-500" />
              <span className="text-xs text-green-600">Amigo confirmado</span>
            </>
          ) : (
            <>
              <Clock className="h-3 w-3 text-yellow-500" />
              <span className="text-xs text-yellow-600">Pendiente de confirmar</span>
            </>
          )}
        </div>
      </div>

      {/* Botón desafiar */}
      {confirmado && onDesafiar && (
        <button
          onClick={onDesafiar}
          className="flex-shrink-0 rounded-lg bg-blue-50 p-2 text-blue-600 hover:bg-blue-100 transition"
          title="Desafiar a jugar"
        >
          <MessageCircle className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

interface BuscarAmigoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAgregar: (jugador: { id: string; nombre_display: string }) => Promise<void>;
}

function BuscarAmigoModal({ isOpen, onClose, onAgregar }: BuscarAmigoModalProps) {
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState<any[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleBuscar = async (q: string) => {
    if (q.length < 2) {
      setResultados([]);
      return;
    }

    setBuscando(true);
    setError(null);
    try {
      // Buscar en jugadores_app por nombre
      const { data, error: searchError } = await supabase
        .from('jugadores_app')
        .select('id, nombre_display, alias')
        .ilike('nombre_display', `%${q}%`)
        .eq('activo', true)
        .limit(10);

      if (searchError) throw searchError;
      setResultados(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al buscar');
    } finally {
      setBuscando(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl bg-white shadow-2xl max-h-96 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 border-b border-gray-200 bg-white px-4 py-4">
          <h2 className="font-bold text-gray-900">Agregar amigo</h2>
          <p className="text-xs text-gray-500 mt-1">
            Busca jugadores para agregarlos a tu red
          </p>
        </div>

        {/* Búsqueda */}
        <div className="px-4 py-3 border-b border-gray-200">
          <input
            type="text"
            placeholder="Nombre del jugador..."
            value={busqueda}
            onChange={(e) => {
              setBusqueda(e.target.value);
              handleBuscar(e.target.value);
            }}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none text-sm"
            autoFocus
          />
        </div>

        {/* Resultados */}
        <div className="p-4 space-y-2">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          {buscando && (
            <div className="text-center py-4">
              <div className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-blue-600" />
            </div>
          )}

          {!buscando && resultados.length === 0 && busqueda.length >= 2 && (
            <div className="text-center py-4 text-sm text-gray-500">
              No se encontraron jugadores
            </div>
          )}

          {resultados.map((jugador) => (
            <div
              key={jugador.id}
              className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50"
            >
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center text-white text-xs font-bold">
                {jugador.nombre_display.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {jugador.nombre_display}
                </p>
                {jugador.alias && (
                  <p className="text-xs text-gray-500">{jugador.alias}</p>
                )}
              </div>
              <button
                onClick={async () => {
                  await onAgregar({ id: jugador.id, nombre_display: jugador.nombre_display });
                  onClose();
                }}
                className="flex-shrink-0 rounded-lg bg-blue-500 text-white px-3 py-1.5 text-xs font-semibold hover:bg-blue-600 transition"
              >
                Agregar
              </button>
            </div>
          ))}
        </div>

        {/* Botón cerrar */}
        <div className="border-t border-gray-200 px-4 py-3 sticky bottom-0 bg-white">
          <button
            onClick={onClose}
            className="w-full py-2 text-gray-600 hover:text-gray-900 font-semibold text-sm"
          >
            Cerrar
          </button>
        </div>
      </div>
    </>
  );
}

export function AmigosPanel() {
  const {
    amigos,
    solicitudesRecibidas,
    solicitudesEnviadas,
    amigosConfirmados,
    isLoading,
    agregarAmigo,
    confirmarAmigo,
    rechazarAmigo,
  } = useJugadorAmigos();
  const [showBuscar, setShowBuscar] = useState(false);

  return (
    <div className="space-y-4">
      {/* Botón agregar */}
      <button
        onClick={() => setShowBuscar(true)}
        className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#0B1F4D] text-white py-3 font-extrabold hover:bg-[#162d6b] transition text-sm shadow-md"
      >
        <UserPlus className="h-4 w-4 text-[#D9F23B]" />
        Agregar amigo
      </button>

      <BuscarAmigoModal
        isOpen={showBuscar}
        onClose={() => setShowBuscar(false)}
        onAgregar={agregarAmigo}
      />

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {/* Solicitudes Recibidas (Requiere respuesta) */}
          {solicitudesRecibidas.length > 0 && (
            <div className="space-y-2.5 bg-amber-50/80 border border-amber-200 p-3.5 rounded-2xl">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
                  <span className="flex h-2 w-2 rounded-full bg-amber-500 animate-ping" />
                  Solicitudes de amistad recibidas ({solicitudesRecibidas.length})
                </h3>
              </div>
              {solicitudesRecibidas.map((amigo) => (
                <div key={amigo.id} className="flex items-center justify-between gap-3 bg-white p-3 rounded-xl border border-amber-200/80 shadow-sm">
                  <div className="flex items-center gap-3 min-w-0">
                    {amigo.foto_url ? (
                      <div
                        className="h-10 w-10 rounded-full bg-cover bg-center shrink-0 border border-amber-300"
                        style={{ backgroundImage: `url(${amigo.foto_url})` }}
                      />
                    ) : (
                      <div className="h-10 w-10 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white font-extrabold text-xs shrink-0">
                        {amigo.nombre_display.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-bold text-sm text-slate-900 truncate">
                        {amigo.nombre_display}
                      </p>
                      {amigo.alias && (
                        <p className="text-xs font-semibold text-amber-700">@{amigo.alias}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => confirmarAmigo(amigo.id)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold px-3 py-1.5 rounded-lg transition"
                    >
                      Aceptar
                    </button>
                    <button
                      onClick={() => rechazarAmigo(amigo.id)}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold px-2.5 py-1.5 rounded-lg transition"
                    >
                      Rechazar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Solicitudes Enviadas (Esperando respuesta) */}
          {solicitudesEnviadas.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-400">
                Solicitudes enviadas ({solicitudesEnviadas.length})
              </h3>
              {solicitudesEnviadas.map((amigo) => (
                <div key={amigo.id} className="flex items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center font-bold text-xs shrink-0">
                      {amigo.nombre_display.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-slate-700 truncate">
                        {amigo.nombre_display}
                      </p>
                      <p className="text-xs text-slate-400">Esperando respuesta...</p>
                    </div>
                  </div>

                  <button
                    onClick={() => rechazarAmigo(amigo.id)}
                    className="text-xs text-slate-400 hover:text-red-500 font-semibold px-2 py-1 transition"
                  >
                    Cancelar
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Amigos Confirmados */}
          {amigosConfirmados.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-400">
                Mis amigos ({amigosConfirmados.length})
              </h3>
              {amigosConfirmados.map((amigo) => (
                <AmigoItem
                  key={amigo.id}
                  nombre={amigo.nombre_display}
                  alias={amigo.alias}
                  confirmado={true}
                />
              ))}
            </div>
          )}

          {amigos.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 py-8 text-center px-4">
              <p className="text-sm font-semibold text-slate-600">
                Aún no tenés amigos agregados.
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Buscá otros jugadores por su nombre para sumar amigos y jugar juntos.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
