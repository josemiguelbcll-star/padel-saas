import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { UserCheck, UserPlus, UserX, Star, Phone } from 'lucide-react';

interface PlayerProfileDialogProps {
  jugadorId: string | null;
  onClose: () => void;
}

export function PlayerProfileDialog({ jugadorId, onClose }: PlayerProfileDialogProps) {
  const [loading, setLoading] = useState(true);
  const [miId, setMiId] = useState<string>('');
  const [player, setPlayer] = useState<any>(null);
  
  // Relación de amistad
  const [relacion, setRelacion] = useState<any>(null);
  const [actionPending, setActionPending] = useState(false);

  // Estadísticas
  const [stats, setStats] = useState({
    partidosJugados: 0,
    partidosOrganizados: 0,
    asistencias: 0,
    noShows: 0,
    nivelCorrecto: 0,
    nivelAlto: 0,
    nivelBajo: 0
  });

  useEffect(() => {
    if (!jugadorId) return;

    async function loadProfile() {
      const targetId = jugadorId;
      if (!targetId) return;
      setLoading(true);
      try {
        // 1. Obtener sesión del usuario actual
        const { data: { session } } = await supabase.auth.getSession();
        let myAppId = '';
        if (session?.user) {
          const { data } = await supabase
            .from('jugadores_app')
            .select('id')
            .eq('auth_user_id', session.user.id)
            .maybeSingle();
          if (data) {
            myAppId = data.id;
            setMiId(data.id);
          }
        }

        // 2. Obtener datos del jugador objetivo
        const { data: targetPlayer, error: pError } = await supabase
          .from('jugadores_app')
          .select('*')
          .eq('id', targetId)
          .maybeSingle();

        if (pError) throw pError;
        setPlayer(targetPlayer);

        // 3. Obtener relación de amistad si no soy yo mismo
        if (myAppId && myAppId !== targetId) {
          const id1 = myAppId < targetId ? myAppId : targetId;
          const id2 = myAppId < targetId ? targetId : myAppId;

          const { data: rel } = await supabase
            .from('jugador_amigos')
            .select('*')
            .eq('jugador_app_id_1', id1)
            .eq('jugador_app_id_2', id2)
            .maybeSingle();

          setRelacion(rel);
        }

        // 4. Obtener estadísticas de partidos de este jugador
        // A. Obtener cantidad de partidos organizados
        const { count: organizados } = await supabase
          .from('partidos_abiertos')
          .select('*', { count: 'exact', head: true })
          .eq('organizador_id', targetId);

        // B. Obtener todas las participaciones del jugador que estén confirmadas
        const { data: participaciones } = await supabase
          .from('partido_participantes')
          .select('asistio, calificacion_nivel')
          .eq('jugador_app_id', targetId)
          .eq('confirmado', true);

        const parts = participaciones ?? [];
        const asistidos = parts.filter(pt => pt.asistio === true).length;
        const noshows = parts.filter(pt => pt.asistio === false).length;
        
        const lvlCorrecto = parts.filter(pt => pt.calificacion_nivel === 'correcto').length;
        const lvlAlto = parts.filter(pt => pt.calificacion_nivel === 'alto').length;
        const lvlBajo = parts.filter(pt => pt.calificacion_nivel === 'bajo').length;

        setStats({
          partidosJugados: parts.length,
          partidosOrganizados: organizados || 0,
          asistencias: asistidos,
          noShows: noshows,
          nivelCorrecto: lvlCorrecto,
          nivelAlto: lvlAlto,
          nivelBajo: lvlBajo
        });

      } catch (err) {
        console.error('Error al cargar perfil de jugador', err);
      } finally {
        setLoading(false);
      }
    }

    void loadProfile();
  }, [jugadorId]);

  // Acciones de amistad
  const handleAgregarAmigo = async () => {
    if (!miId || !jugadorId || actionPending) return;
    setActionPending(true);
    try {
      const id1 = miId < jugadorId ? miId : jugadorId;
      const id2 = miId < jugadorId ? jugadorId : miId;

      const { data, error } = await supabase
        .from('jugador_amigos')
        .insert({
          jugador_app_id_1: id1,
          jugador_app_id_2: id2,
          confirmado: false,
          solicitante_id: miId,
        })
        .select()
        .single();

      if (error) throw error;
      setRelacion(data);

      // Crear notificación
      await supabase.from('notificaciones').insert({
        jugador_app_id: jugadorId,
        titulo: '🤝 Nueva solicitud de amistad',
        mensaje: `${player?.nombre_display || 'Un jugador'} te envió una solicitud de amistad.`,
        tipo: 'solicitud_amigo',
        leido: false,
      });

    } catch (err) {
      console.error(err);
    } finally {
      setActionPending(false);
    }
  };

  const handleConfirmarAmigo = async () => {
    if (!miId || !jugadorId || actionPending) return;
    setActionPending(true);
    try {
      const id1 = miId < jugadorId ? miId : jugadorId;
      const id2 = miId < jugadorId ? jugadorId : miId;

      const { data, error } = await supabase
        .from('jugador_amigos')
        .update({ confirmado: true })
        .eq('jugador_app_id_1', id1)
        .eq('jugador_app_id_2', id2)
        .select()
        .single();

      if (error) throw error;
      setRelacion(data);

      // Crear notificación
      await supabase.from('notificaciones').insert({
        jugador_app_id: jugadorId,
        titulo: '✅ Solicitud de amistad aceptada',
        mensaje: `${player?.nombre_display || 'Un amigo'} aceptó tu solicitud de amistad.`,
        tipo: 'solicitud_aceptada',
        leido: false,
      });

    } catch (err) {
      console.error(err);
    } finally {
      setActionPending(false);
    }
  };

  const handleEliminarAmigo = async () => {
    if (!miId || !jugadorId || actionPending) return;
    if (!confirm(`¿Seguro que querés eliminar la relación con ${player?.nombre_display}?`)) return;
    setActionPending(true);
    try {
      const id1 = miId < jugadorId ? miId : jugadorId;
      const id2 = miId < jugadorId ? jugadorId : miId;

      const { error } = await supabase
        .from('jugador_amigos')
        .delete()
        .eq('jugador_app_id_1', id1)
        .eq('jugador_app_id_2', id2);

      if (error) throw error;
      setRelacion(null);
    } catch (err) {
      console.error(err);
    } finally {
      setActionPending(false);
    }
  };

  if (!jugadorId) return null;

  // Cálculo de presentismo
  const totalCalificacionesAsistencia = stats.asistencias + stats.noShows;
  const presentismoPct = totalCalificacionesAsistencia > 0 
    ? Math.round((stats.asistencias / totalCalificacionesAsistencia) * 100) 
    : null;

  // Formatear WhatsApp
  const phoneClean = player?.telefono ? player.telefono.replace(/[^\d+]/g, '') : '';
  const waUrl = phoneClean ? `https://wa.me/${phoneClean.startsWith('+') ? phoneClean.slice(1) : phoneClean}` : '';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16
    }}>
      <div style={{
        background: '#ffffff', width: '100%', maxWidth: 420,
        borderRadius: 24, padding: 24,
        boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
        maxHeight: '90vh', overflowY: 'auto',
        display: 'flex', flexDirection: 'column', gap: 16,
        position: 'relative'
      }}>
        {/* Botón Cerrar */}
        <button
          type="button"
          onClick={onClose}
          style={{
            position: 'absolute', top: 16, right: 16,
            background: '#F1F5F9', border: 'none', borderRadius: 99,
            width: 32, height: 32, cursor: 'pointer', fontWeight: 700, color: '#64748B'
          }}
        >
          ✕
        </button>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🎾</div>
            <p style={{ fontSize: 14, color: '#64748B' }}>Cargando perfil...</p>
          </div>
        ) : !player ? (
          <div style={{ textAlign: 'center', padding: '20px 0', color: '#EF4444' }}>
            No se pudo encontrar la información del jugador.
          </div>
        ) : (
          <>
            {/* Header del Perfil */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center', marginTop: 12 }}>
              {player.foto_url ? (
                <div style={{
                  width: 80, height: 80, borderRadius: '50%',
                  backgroundImage: `url(${player.foto_url})`,
                  backgroundSize: 'cover', backgroundPosition: 'center',
                  border: '3px solid #39C54A'
                }} />
              ) : (
                <div style={{
                  width: 80, height: 80, borderRadius: '50%',
                  background: 'linear-gradient(135deg, #0B1F4D 0%, #162d6b 100%)',
                  color: '#ffffff', fontWeight: 800, fontSize: 32,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '3px solid #D9F23B'
                }}>
                  {player.nombre_display.charAt(0).toUpperCase()}
                </div>
              )}

              <div>
                <h3 style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 800, fontSize: 19, color: '#0B1F4D', margin: '0 0 2px' }}>
                  {player.nombre_display}
                </h3>
                {player.alias && (
                  <p style={{ fontSize: 13, color: '#64748B', fontWeight: 600, margin: 0 }}>
                    @{player.alias}
                  </p>
                )}
              </div>

              {/* Categoría y Género */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                {player.categoria && (
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#0B1F4D', background: '#D9F23B', borderRadius: 12, padding: '4px 12px' }}>
                    Cat: {player.categoria}
                  </span>
                )}
                {player.genero && (
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#475569', background: '#E2E8F0', borderRadius: 12, padding: '4px 12px', textTransform: 'capitalize' }}>
                    {player.genero}
                  </span>
                )}
              </div>
            </div>

            {/* Coordinación y Contacto */}
            {miId !== jugadorId && (
              <div style={{ borderTop: '1px solid #E2E8F0', borderBottom: '1px solid #E2E8F0', padding: '14px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {waUrl ? (
                  <a
                    href={waUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      background: '#25D366', color: '#ffffff', textDecoration: 'none',
                      padding: '12px', borderRadius: 12, fontWeight: 800, fontSize: 14,
                      textAlign: 'center', boxShadow: '0 2px 10px rgba(37,211,102,0.2)'
                    }}
                  >
                    <Phone className="w-4 h-4" /> Coordinar por WhatsApp
                  </a>
                ) : (
                  <p style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', fontStyle: 'italic', margin: 0 }}>
                    El jugador no registró número de contacto para WhatsApp.
                  </p>
                )}
              </div>
            )}

            {/* Sección Estadísticas de Comunidad */}
            <div style={{ background: '#F8F9FC', borderRadius: 16, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h4 style={{ fontSize: 12, fontWeight: 800, color: '#64748B', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Estadísticas de Comunidad
              </h4>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#334155' }}>
                <span>Partidos en comunidad:</span>
                <strong style={{ color: '#0B1F4D' }}>{stats.partidosJugados} jugados / {stats.partidosOrganizados} creados</strong>
              </div>

              {/* Presentismo */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#334155' }}>
                  <span>Presentismo de asistencia:</span>
                  <strong style={{ color: presentismoPct !== null && presentismoPct < 85 ? '#EF4444' : '#16A34A' }}>
                    {presentismoPct !== null ? `${presentismoPct}%` : 'Sin registros'}
                  </strong>
                </div>
                {presentismoPct !== null && (
                  <div style={{ width: '100%', height: 6, background: '#E2E8F0', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${presentismoPct}%`, height: '100%', background: presentismoPct < 85 ? '#EF4444' : '#39C54A' }} />
                  </div>
                )}
                {totalCalificacionesAsistencia > 0 && (
                  <span style={{ fontSize: 11, color: '#64748B', fontStyle: 'italic' }}>
                    ({stats.asistencias} partidos asistidos · {stats.noShows} ausencias/no-shows)
                  </span>
                )}
              </div>

              {/* Nivel reportado por oponentes */}
              <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700, color: '#475569' }}>
                  <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" /> Nivel percibido por oponentes:
                </div>
                {stats.nivelCorrecto + stats.nivelAlto + stats.nivelBajo === 0 ? (
                  <p style={{ fontSize: 12, color: '#64748B', fontStyle: 'italic', margin: 0 }}>
                    Aún no calificado por otros organizadores.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Nivel acorde a categoría:</span>
                      <strong>{stats.nivelCorrecto} veces</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Nivel superior a categoría:</span>
                      <strong style={{ color: '#1D4ED8' }}>{stats.nivelAlto} veces</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Nivel inferior a categoría:</span>
                      <strong style={{ color: '#D97706' }}>{stats.nivelBajo} veces</strong>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Acción de Amistad */}
            {miId && miId !== jugadorId && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                {relacion?.confirmado ? (
                  <button
                    type="button"
                    disabled={actionPending}
                    onClick={handleEliminarAmigo}
                    style={{
                      width: '100%', padding: '12px', borderRadius: 12, border: '1.5px solid #EF4444',
                      background: 'transparent', color: '#EF4444', fontWeight: 800, fontSize: 13,
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
                    }}
                  >
                    <UserX className="w-4 h-4" /> Eliminar Amigo
                  </button>
                ) : relacion ? (
                  // Solicitud pendiente
                  relacion.solicitante_id === miId ? (
                    <button
                      type="button"
                      disabled={actionPending}
                      onClick={handleEliminarAmigo}
                      style={{
                        width: '100%', padding: '12px', borderRadius: 12, border: '1.5px solid #94A3B8',
                        background: 'transparent', color: '#64748B', fontWeight: 700, fontSize: 13,
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
                      }}
                    >
                      <UserX className="w-4 h-4" /> Cancelar Solicitud Enviada
                    </button>
                  ) : (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        disabled={actionPending}
                        onClick={handleConfirmarAmigo}
                        style={{
                          flex: 1, padding: '12px', borderRadius: 12, border: 'none',
                          background: '#0B1F4D', color: '#ffffff', fontWeight: 800, fontSize: 13,
                          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
                        }}
                      >
                        <UserCheck className="w-4 h-4" /> Aceptar Amigo
                      </button>
                      <button
                        type="button"
                        disabled={actionPending}
                        onClick={handleEliminarAmigo}
                        style={{
                          padding: '12px 16px', borderRadius: 12, border: '1px solid #E2E8F0',
                          background: '#F1F5F9', color: '#475569', fontWeight: 700, fontSize: 13,
                          cursor: 'pointer'
                        }}
                      >
                        Rechazar
                      </button>
                    </div>
                  )
                ) : (
                  // No hay relación
                  <button
                    type="button"
                    disabled={actionPending}
                    onClick={handleAgregarAmigo}
                    style={{
                      width: '100%', padding: '12px', borderRadius: 12, border: 'none',
                      background: '#0B1F4D', color: '#ffffff', fontWeight: 800, fontSize: 14,
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      boxShadow: '0 2px 10px rgba(11,31,77,0.15)'
                    }}
                  >
                    <UserPlus className="w-4 h-4" /> Agregar como Amigo
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
