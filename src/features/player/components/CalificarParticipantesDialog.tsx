import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface CalificarParticipantesDialogProps {
  partidoId: number;
  categoria: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function CalificarParticipantesDialog({ partidoId, categoria, onClose, onSuccess }: CalificarParticipantesDialogProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [participantes, setParticipantes] = useState<any[]>([]);

  // Guardar puntuaciones locales en estado indexado por ID de participante
  const [puntuaciones, setPuntuaciones] = useState<Record<number, { asistio: boolean | null; calificacion_nivel: string | null }>>({});

  useEffect(() => {
    async function loadParticipants() {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('partido_participantes')
          .select(`
            id,
            asistio,
            calificacion_nivel,
            jugador:jugadores_app(
              nombre_display,
              alias
            )
          `)
          .eq('partido_abierto_id', partidoId)
          .eq('confirmado', true);

        if (error) throw error;

        const rows = data ?? [];
        setParticipantes(rows);

        // Inicializar estado local
        const initialPunts: Record<number, any> = {};
        for (const row of rows) {
          initialPunts[row.id] = {
            asistio: row.asistio,
            calificacion_nivel: row.calificacion_nivel || 'correcto' // 'correcto' por defecto si asistió
          };
        }
        setPuntuaciones(initialPunts);

      } catch (err) {
        console.error('Error al cargar participantes para calificar', err);
      } finally {
        setLoading(false);
      }
    }

    void loadParticipants();
  }, [partidoId]);

  const handleAsistenciaChange = (partId: number, asistio: boolean) => {
    setPuntuaciones(prev => {
      const current = prev[partId] || { asistio: null, calificacion_nivel: null };
      return {
        ...prev,
        [partId]: {
          asistio,
          calificacion_nivel: asistio ? (current.calificacion_nivel || 'correcto') : null
        }
      };
    });
  };

  const handleNivelChange = (partId: number, nivel: string) => {
    setPuntuaciones(prev => {
      const current = prev[partId] || { asistio: null, calificacion_nivel: null };
      return {
        ...prev,
        [partId]: {
          asistio: current.asistio,
          calificacion_nivel: nivel
        }
      };
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Guardar calificaciones una a una
      for (const part of participantes) {
        const punt = puntuaciones[part.id] || { asistio: null, calificacion_nivel: null };
        const { error } = await supabase
          .from('partido_participantes')
          .update({
            asistio: punt.asistio,
            calificacion_nivel: punt.calificacion_nivel
          })
          .eq('id', part.id);

        if (error) throw error;
      }

      onSuccess();
    } catch (err) {
      alert('Error al guardar las calificaciones: ' + (err instanceof Error ? err.message : 'Error desconocido'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16
    }}>
      <div style={{
        background: '#ffffff', width: '100%', maxWidth: 440,
        borderRadius: 24, padding: 24,
        boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
        maxHeight: '85vh', overflowY: 'auto',
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

        <div>
          <h3 style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 800, fontSize: 18, color: '#0B1F4D', margin: '0 0 4px' }}>
            Puntuar participantes
          </h3>
          <p style={{ fontSize: 12, color: '#64748B', margin: 0 }}>
            Ayudá a mantener la comunidad sana puntuando el presentismo y el nivel para la categoría <strong>{categoria}</strong>.
          </p>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '30px 0' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🎾</div>
            <p style={{ fontSize: 13, color: '#64748B' }}>Cargando jugadores...</p>
          </div>
        ) : participantes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '20px 0', color: '#64748B', fontSize: 13 }}>
            No hubo otros participantes confirmados en este partido.
          </div>
        ) : (
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {participantes.map(part => {
                const punt = puntuaciones[part.id] || { asistio: null, calificacion_nivel: null };
                const asistio = punt.asistio;

                return (
                  <div
                    key={part.id}
                    style={{
                      border: '1.5px solid #E2E8F0',
                      borderRadius: 16,
                      padding: 14,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10
                    }}
                  >
                    {/* Nombre Jugador */}
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#0B1F4D' }}>
                      {part.jugador?.nombre_display} {part.jugador?.alias ? `(@${part.jugador.alias})` : ''}
                    </div>

                    {/* Asistencia */}
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 700, color: '#64748B', display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>
                        Asistencia
                      </label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          onClick={() => handleAsistenciaChange(part.id, true)}
                          style={{
                            flex: 1, padding: '8px 10px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                            border: asistio === true ? 'none' : '1.5px solid #E2E8F0',
                            background: asistio === true ? '#DDF6E4' : '#ffffff',
                            color: asistio === true ? '#16A34A' : '#374151',
                          }}
                        >
                          🟢 Asistió
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAsistenciaChange(part.id, false)}
                          style={{
                            flex: 1, padding: '8px 10px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                            border: asistio === false ? 'none' : '1.5px solid #E2E8F0',
                            background: asistio === false ? '#FEE2E2' : '#ffffff',
                            color: asistio === false ? '#DC2626' : '#374151',
                          }}
                        >
                          🔴 No Show
                        </button>
                      </div>
                    </div>

                    {/* Calificación Nivel (solo si asistió) */}
                    {asistio === true && (
                      <div style={{ borderTop: '1px dashed #E2E8F0', paddingTop: 10 }}>
                        <label style={{ fontSize: 11, fontWeight: 700, color: '#64748B', display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>
                          Nivel de Juego
                        </label>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {['bajo', 'correcto', 'alto'].map(lvl => {
                            const isLvlSelected = punt.calificacion_nivel === lvl;
                            let label = 'Acorde';
                            let emoji = '⚖️';
                            let activeBg = '#DBEAFE';
                            let activeColor = '#1D4ED8';

                            if (lvl === 'bajo') {
                              label = 'Muy Bajo';
                              emoji = '📉';
                              activeBg = '#FEF3C7';
                              activeColor = '#D97706';
                            } else if (lvl === 'alto') {
                              label = 'Muy Alto';
                              emoji = '📈';
                              activeBg = '#F3E8FF';
                              activeColor = '#7C3AED';
                            }

                            return (
                              <button
                                key={lvl}
                                type="button"
                                onClick={() => handleNivelChange(part.id, lvl)}
                                style={{
                                  flex: 1, padding: '6px 4px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                                  border: isLvlSelected ? 'none' : '1.5px solid #E2E8F0',
                                  background: isLvlSelected ? activeBg : '#ffffff',
                                  color: isLvlSelected ? activeColor : '#475569',
                                }}
                              >
                                {emoji} {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              type="submit"
              disabled={saving}
              style={{
                width: '100%', padding: '14px', borderRadius: 14, border: 'none',
                background: '#0B1F4D', color: '#ffffff', fontWeight: 800, fontSize: 14,
                cursor: 'pointer', boxShadow: '0 4px 12px rgba(11,31,77,0.2)',
                marginTop: 6
              }}
            >
              {saving ? 'Guardando...' : '💾 Guardar puntuaciones'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
