import { useState, useEffect } from 'react';
import {
  Bell,
  CheckCircle2,
  Trophy,
  UserPlus,
  Swords,
  Calendar,
  Radio,
  X,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications } from '@capacitor/push-notifications';
import { dispararNotificacionPrueba } from '@/lib/notifications';
import { cn } from '@/lib/utils';

interface ConfigurarNotificacionesModalProps {
  onClose: () => void;
  jugadorId: string;
  nombreJugador: string;
}

interface CanalNotificacion {
  id: string;
  titulo: string;
  descripcion: string;
  icono: any;
  defaultActivo: boolean;
  color: string;
}

const CANALES: CanalNotificacion[] = [
  {
    id: 'invitaciones_partido',
    titulo: '🎾 Invitaciones a Partidos',
    descripcion: 'Avisos al celular cuando un amigo o jugador te invite a sumarte a su cancha o partido abierto.',
    icono: Trophy,
    defaultActivo: true,
    color: 'emerald',
  },
  {
    id: 'solicitudes_unirse',
    titulo: '🙋 Solicitudes de Unión',
    descripcion: 'Avisos cuando un jugador solicite sumarse a un partido abierto que vos organizaste.',
    icono: Trophy,
    defaultActivo: true,
    color: 'emerald',
  },
  {
    id: 'solicitudes_amigos',
    titulo: '🤝 Comunidad y Amigos',
    descripcion: 'Avisos de nuevas solicitudes de amistad recibidas y confirmaciones de amigos.',
    icono: UserPlus,
    defaultActivo: true,
    color: 'blue',
  },
  {
    id: 'desafios',
    titulo: '⚔️ Desafíos y Retos',
    descripcion: 'Avisos al instante cuando una pareja o jugador te rete a un partido en un club.',
    icono: Swords,
    defaultActivo: true,
    color: 'amber',
  },
  {
    id: 'recordatorios_turnos',
    titulo: '📅 Recordatorios de Turnos',
    descripcion: 'Alertas previas a la hora de tu partido y confirmaciones automáticas de reservas.',
    icono: Calendar,
    defaultActivo: true,
    color: 'indigo',
  },
  {
    id: 'noticias_clubes',
    titulo: '📢 Noticias y Torneos',
    descripcion: 'Publicaciones oficiales, promociones y torneos de tus clubes frecuentes.',
    icono: Radio,
    defaultActivo: true,
    color: 'purple',
  },
];

export function ConfigurarNotificacionesModal({
  onClose,
  jugadorId,
  nombreJugador,
}: ConfigurarNotificacionesModalProps) {
  const [preferencias, setPreferencias] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('matchgo_notif_prefs');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      invitaciones_partido: true,
      solicitudes_unirse: true,
      solicitudes_amigos: true,
      desafios: true,
      recordatorios_turnos: true,
      noticias_clubes: true,
    };
  });

  const [permisoConcedido, setPermisoConcedido] = useState<boolean>(true);
  const [testEnviado, setTestEnviado] = useState(false);
  const [loadingTest, setLoadingTest] = useState(false);

  useEffect(() => {
    async function checkStatus() {
      if (Capacitor.isNativePlatform()) {
        try {
          const res = await LocalNotifications.checkPermissions();
          setPermisoConcedido(res.display === 'granted');
        } catch {
          setPermisoConcedido(true);
        }
      }
    }
    void checkStatus();
  }, []);

  const togglePreferencia = (canalId: string) => {
    const updated = { ...preferencias, [canalId]: !preferencias[canalId] };
    setPreferencias(updated);
    try {
      localStorage.setItem('matchgo_notif_prefs', JSON.stringify(updated));
    } catch {}
  };

  const handleSolicitarPermiso = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        const res = await LocalNotifications.requestPermissions();
        await PushNotifications.requestPermissions().catch(() => {});
        setPermisoConcedido(res.display === 'granted');
      } catch (err) {
        console.warn('Error al pedir permisos:', err);
      }
    }
  };

  const handleEnviarPrueba = async () => {
    setLoadingTest(true);
    setTestEnviado(false);
    try {
      await dispararNotificacionPrueba(jugadorId, nombreJugador || 'Jugador');
      setTestEnviado(true);
      setTimeout(() => setTestEnviado(false), 6000);
    } catch (err) {
      console.error('Error al enviar prueba:', err);
    } finally {
      setLoadingTest(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90dvh]"
        style={{ fontFamily: "'Inter', sans-serif" }}
      >
        {/* Header */}
        <div className="bg-[#0B1F4D] text-white px-6 py-5 flex items-center justify-between border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-white/10 flex items-center justify-center text-white">
              <Bell className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-white">Centro de Notificaciones</h2>
              <p className="text-xs text-white/70">Configuración de alertas para tu celular</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Banner de Estado del Dispositivo */}
          <div
            className={cn(
              'p-4 rounded-2xl border flex items-start gap-3.5',
              permisoConcedido
                ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                : 'bg-amber-50 border-amber-200 text-amber-950'
            )}
          >
            <div
              className={cn(
                'h-9 w-9 rounded-full flex items-center justify-center shrink-0 font-bold',
                permisoConcedido ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white'
              )}
            >
              <Smartphone className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-extrabold uppercase tracking-wider">
                  {permisoConcedido ? 'Notificaciones Activas en este Celular' : 'Permiso de Notificaciones Requerido'}
                </h3>
              </div>
              <p className="text-xs mt-1 leading-relaxed opacity-90">
                {permisoConcedido
                  ? 'Tu dispositivo está registrado para recibir notificaciones instantáneas de partidos, amigos y desafíos.'
                  : 'Para recibir alertas en tu barra de notificaciones y pantalla de bloqueo, debés habilitar los permisos.'}
              </p>
              {!permisoConcedido && (
                <button
                  onClick={handleSolicitarPermiso}
                  className="mt-2.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold px-3.5 py-1.5 rounded-lg transition shadow-xs"
                >
                  Activar Permisos Ahora
                </button>
              )}
            </div>
          </div>

          {/* Botón de Envío de Notificación de Prueba */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-100 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-indigo-600" />
                <h4 className="text-xs font-extrabold text-indigo-950">Probar Notificaciones en Vivo</h4>
              </div>
            </div>
            <p className="text-xs text-indigo-800 leading-relaxed">
              Enviá una notificación de prueba para verificar que tu teléfono vibre y muestre la alerta en la barra superior.
            </p>
            <button
              disabled={loadingTest}
              onClick={handleEnviarPrueba}
              className="mt-1 w-full flex items-center justify-center gap-2 bg-[#0B1F4D] hover:bg-[#162d6b] active:scale-[0.99] disabled:opacity-50 text-white text-xs font-extrabold py-3 px-4 rounded-xl transition shadow-md"
            >
              <Bell className="h-4 w-4" />
              {loadingTest ? 'Enviando alerta...' : 'Enviar Notificación de Prueba al Celular'}
            </button>

            {testEnviado && (
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 bg-emerald-100/80 p-2.5 rounded-xl animate-in fade-in">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                ¡Alerta enviada con éxito! Revisá la barra superior de tu celular.
              </div>
            )}
          </div>

          {/* Listado de Canales y Configuración */}
          <div className="space-y-2">
            <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 px-1">
              Eventos y Alertas Configurados
            </h4>

            <div className="space-y-2">
              {CANALES.map((canal) => {
                const activo = preferencias[canal.id] ?? canal.defaultActivo;
                const Icono = canal.icono;

                return (
                  <div
                    key={canal.id}
                    onClick={() => togglePreferencia(canal.id)}
                    className={cn(
                      'p-3.5 rounded-2xl border transition-all cursor-pointer flex items-start gap-3.5',
                      activo
                        ? 'bg-white border-slate-200/90 shadow-xs'
                        : 'bg-slate-50/80 border-slate-100 opacity-60'
                    )}
                  >
                    <div
                      className={cn(
                        'h-9 w-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5',
                        activo ? 'bg-[#0B1F4D] text-white' : 'bg-slate-200 text-slate-500'
                      )}
                    >
                      <Icono className="h-4 w-4" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-extrabold text-slate-900">{canal.titulo}</span>
                        {/* Custom Switch pill */}
                        <span
                          className={cn(
                            'text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider',
                            activo ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                          )}
                        >
                          {activo ? 'Activo' : 'Pausado'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 font-medium mt-0.5 leading-relaxed">
                        {canal.descripcion}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end">
          <button
            onClick={onClose}
            className="bg-[#0B1F4D] hover:bg-[#162d6b] text-white text-xs font-extrabold px-6 py-2.5 rounded-xl transition"
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}
