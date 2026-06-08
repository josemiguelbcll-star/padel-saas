import './desafios.css';
import { useState } from 'react';
import {
  escalera, miPareja, miJugador, circulo, desafios as mockDesafios,
  slotsDisponibles, jugadoresBuscables,
  type Pareja, type Desafio, type SlotMock, type Jugador,
  categoriaLabel, moneda, parejaLabel, parejaLabelAnd,
} from './mockData';

// ─── íconos inline ───────────────────────────────────────────────────────────
const I = {
  trophy:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="8 21 12 21 16 21"/><line x1="12" y1="17" x2="12" y2="21"/><path d="M7 4H4a2 2 0 0 0-2 2v3a5 5 0 0 0 5 5 5 5 0 0 0 5-5V4H7z"/><path d="M21 4h-3v5a5 5 0 0 1-10 0"/></svg>,
  swords:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 17.5L3 6V3h3l11.5 11.5"/><path d="M13 19l6-6"/><path d="M16 16l4 4"/><path d="M19 21l2-2"/><path d="M14.5 6.5L18 3h3v3l-3.5 3.5"/><path d="M5 14l5 5"/><path d="M3 19l2 2"/></svg>,
  user2:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 19a6 6 0 0 0-12 0"/><circle cx="8" cy="9" r="4"/><path d="M22 19a6 6 0 0 0-6-6 4 4 0 1 0 0-8"/></svg>,
  bell:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  check:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  x:        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  calendar: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  mapPin:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
  zap:      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  arrowUp:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>,
  info:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>,
  clock:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  star:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  search:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  userPlus: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>,
  link2:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>,
  edit:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
};

// ─── tipos overlay ────────────────────────────────────────────────────────────
type OverlayKind =
  | { kind: 'proponer'; rival: Pareja; step: 1 | 2 | 3 }
  | { kind: 'aceptar'; desafio: Desafio }
  | { kind: 'resultado'; desafio: Desafio; mios: number; rivales: number }
  | { kind: 'confirmar_resultado'; desafio: Desafio }
  | { kind: 'invitar'; step: 1 | 2 | 3; jugadorSeleccionado: Jugador | null }
  | { kind: 'apodo' };

type Tab = 'circulo' | 'desafios' | 'pareja';

function estadoLabel(e: Desafio['estado']) {
  const map: Record<Desafio['estado'], string> = {
    recibido: 'Te desafiaron', enviado: 'Esperando respuesta',
    agendado: 'Partido agendado', a_confirmar: 'Confirmá el resultado', jugado: 'Jugado',
  };
  return map[e];
}

function rachaLabel(r: number) {
  if (r > 0) return <span className="r-streak-up">▲ {r} seguidas</span>;
  if (r < 0) return <span className="r-streak-down">▼ {Math.abs(r)} seguidas</span>;
  return <span style={{ color: 'var(--muted)' }}>—</span>;
}

// ─── Avatares de pareja (2 superpuestos) ─────────────────────────────────────
function ParejaAvs({ p, size = 32 }: { p: Pareja; size?: number }) {
  const fs = Math.round(size * 0.38);
  const offset = Math.round(size * 0.34);
  return (
    <div style={{ display: 'flex' }}>
      {p.jugadores.map((j, i) => (
        <div key={j.id} style={{
          width: size, height: size, borderRadius: '50%',
          display: 'grid', placeItems: 'center',
          fontSize: fs, fontWeight: 700, color: '#fff',
          background: i === 0 ? 'var(--marino)' : '#16306f',
          border: '2px solid #fff',
          marginLeft: i === 0 ? 0 : -offset,
          boxShadow: '0 1px 3px rgba(0,0,0,.12)',
        }}>{j.avatar}</div>
      ))}
    </div>
  );
}

export function DesafiosPrototype() {
  const [tab, setTab] = useState<Tab>('circulo');
  const [overlay, setOverlay] = useState<OverlayKind | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<SlotMock | null>(null);
  const [desafioList, setDesafioList] = useState<Desafio[]>(mockDesafios);
  const [apodoGuardado, setApodoGuardado] = useState<string>('');
  const [apodoDraft, setApodoDraft] = useState('');
  const [busqueda, setBusqueda] = useState('');

  function closeOverlay() { setOverlay(null); setSelectedSlot(null); setBusqueda(''); }

  function proponer(rival: Pareja) {
    setSelectedSlot(null);
    setOverlay({ kind: 'proponer', rival, step: 1 });
  }

  function advanceProponer() {
    if (!overlay || overlay.kind !== 'proponer') return;
    if (overlay.step === 1) setOverlay({ ...overlay, step: 2 });
    else if (overlay.step === 2 && selectedSlot) setOverlay({ ...overlay, step: 3 });
  }

  function aceptarDesafio(d: Desafio) {
    setDesafioList(prev => prev.map(x => x.id === d.id
      ? { ...x, estado: 'agendado', club: 'Signo D Padel', fecha: 'Sáb 14 jun', hora: '19:30', cancha: 'Cancha 2', precio: 9000 }
      : x));
    closeOverlay();
  }

  function confirmarResultado(d: Desafio, mios: number, rivales: number) {
    const gane = mios > rivales;
    setDesafioList(prev => prev.map(x => x.id === d.id
      ? { ...x, estado: 'jugado', resultado: { miosSets: mios, rivalSets: rivales, gane } }
      : x));
    setOverlay({ kind: 'confirmar_resultado', desafio: { ...d, resultado: { miosSets: mios, rivalSets: rivales, gane } } });
  }

  const pendientes = desafioList.filter(d => d.estado !== 'jugado').length;
  const resultadosFiltrados = jugadoresBuscables.filter(j =>
    busqueda.length >= 2 &&
    (j.nombreCompleto.toLowerCase().includes(busqueda.toLowerCase()) ||
     j.nombre.toLowerCase().includes(busqueda.toLowerCase()))
  );

  return (
    <div className="mg-desafios">
      <div className="mgd-intro">
        <div className="badge">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          Prototipo visual — sin backend
        </div>
        <h1>Desafíos de parejas<br />en MatchGo</h1>
        <p>Parejas fijas sin nombre obligatorio · Identidad = los dos jugadores</p>
      </div>

      <div className="mgd-phone">
        <div className="mgd-notch" />

        {/* TOP BAR */}
        <div className="mgd-topbar">
          <div className="tb-circle">
            <span className="tb-eyebrow">Mi círculo</span>
            <span className="tb-name">{circulo.nombre}</span>
            <span className="tb-sub">{circulo.miembros} parejas · {circulo.zona}</span>
          </div>
          <button className="tb-bell">
            {I.bell}
            {pendientes > 0 && <span className="tb-dot" />}
          </button>
        </div>

        {/* BODY */}
        <div className="mgd-body">
          {tab === 'circulo' && <TabCirculo onDesafiar={proponer} />}
          {tab === 'desafios' && (
            <TabDesafios
              desafios={desafioList}
              onAceptar={(d) => setOverlay({ kind: 'aceptar', desafio: d })}
              onCargarResultado={(d) => setOverlay({ kind: 'resultado', desafio: d, mios: 2, rivales: 1 })}
            />
          )}
          {tab === 'pareja' && (
            <TabPareja
              apodo={apodoGuardado}
              onInvitar={() => setOverlay({ kind: 'invitar', step: 1, jugadorSeleccionado: null })}
              onEditarApodo={() => { setApodoDraft(apodoGuardado); setOverlay({ kind: 'apodo' }); }}
            />
          )}
        </div>

        {/* TAB BAR */}
        <div className="mgd-tabbar">
          <button className={`mgd-tab ${tab === 'circulo' ? 'on' : ''}`} onClick={() => setTab('circulo')}>
            {I.trophy}<span>Círculo</span>
          </button>
          <button className={`mgd-tab ${tab === 'desafios' ? 'on' : ''}`} onClick={() => setTab('desafios')} style={{ position: 'relative' }}>
            {I.swords}<span>Desafíos</span>
            {pendientes > 0 && (
              <span style={{ position: 'absolute', top: 6, right: 18, width: 18, height: 18, borderRadius: '50%', background: 'var(--rose)', color: '#fff', fontSize: 10, fontWeight: 800, display: 'grid', placeItems: 'center' }}>{pendientes}</span>
            )}
          </button>
          <button className={`mgd-tab ${tab === 'pareja' ? 'on' : ''}`} onClick={() => setTab('pareja')}>
            {I.user2}<span>Mi pareja</span>
          </button>
        </div>

        {/* ===== OVERLAYS ===== */}
        {overlay && (
          <div className="mgd-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeOverlay(); }}>
            <div className="mgd-sheet">
              <div className="sh-grip" />

              {/* ── PROPONER DESAFÍO ── */}
              {overlay.kind === 'proponer' && (
                <>
                  <div className="sh-head">
                    <div>
                      <div className="sh-title">
                        {overlay.step === 1 && '⚔️ Proponer desafío'}
                        {overlay.step === 2 && '📅 Elegí el horario'}
                        {overlay.step === 3 && '¡Desafío enviado!'}
                      </div>
                      <div className="sh-sub">
                        {overlay.step === 1 && 'Revisá a quién desafiás'}
                        {overlay.step === 2 && 'Canchas disponibles en tu zona'}
                        {overlay.step === 3 && `${parejaLabel(overlay.rival)} recibió tu desafío`}
                      </div>
                    </div>
                    <button className="sh-close" onClick={closeOverlay}>{I.x}</button>
                  </div>
                  <div className="sh-body">
                    <div className="mgd-steps">
                      <div className={`st ${overlay.step >= 1 ? 'on' : ''}`} />
                      <div className={`st ${overlay.step >= 2 ? 'on' : ''}`} />
                      <div className={`st ${overlay.step >= 3 ? 'on' : ''}`} />
                    </div>

                    {overlay.step === 1 && (
                      <>
                        <div className="mgd-flowlabel">Vas a desafiar a:</div>
                        <RivalMini p={overlay.rival} />
                        <div style={{ background: 'var(--green-soft)', borderRadius: 13, padding: '13px 14px', marginTop: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
                          <div style={{ color: 'var(--green-dark)', flexShrink: 0 }}>{I.arrowUp}</div>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--ink)' }}>Si ganás, subís al puesto #{overlay.rival.posicion}</div>
                            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>La escalera se actualiza al confirmar el resultado</div>
                          </div>
                        </div>
                        <div style={{ background: 'var(--bg-soft)', borderRadius: 13, padding: '11px 14px', marginTop: 10, display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                          <div style={{ color: 'var(--amber)', marginTop: 1, flexShrink: 0 }}>{I.info}</div>
                          <div style={{ fontSize: 12.5, color: 'var(--body)' }}>
                            <strong style={{ color: 'var(--ink)' }}>Reglas del círculo:</strong> el desafiado tiene <strong>4 días</strong> para aceptar o cede la posición.
                          </div>
                        </div>
                      </>
                    )}

                    {overlay.step === 2 && (
                      <>
                        <div className="mgd-flowlabel">Canchas disponibles en tu zona:</div>
                        <div className="mgd-slots">
                          {slotsDisponibles.map((s, i) => (
                            <button key={i} className={`mgd-slot ${selectedSlot === s ? 'on' : ''}`} onClick={() => setSelectedSlot(s)}>
                              <div className="sl-hora">{s.hora}</div>
                              <div className="sl-info">
                                <div className="sl-club">{s.club}</div>
                                <div className="sl-cancha">{s.cancha}</div>
                              </div>
                              <div className="sl-price">
                                <div className="sl-amt">{moneda(s.precio)}</div>
                                {s.valle && <div className="sl-valle">−30% valle</div>}
                              </div>
                            </button>
                          ))}
                        </div>
                        {selectedSlot?.valle && (
                          <div style={{ background: 'var(--green-soft)', border: '1px solid #b2e8b8', borderRadius: 11, padding: '10px 13px', marginTop: 12, display: 'flex', gap: 9, alignItems: 'center' }}>
                            <div style={{ color: 'var(--green-dark)', flexShrink: 0 }}>{I.zap}</div>
                            <div style={{ fontSize: 12, color: 'var(--green-dark)', fontWeight: 600 }}>
                              Turno valle — precio especial. MatchGo lo sugiere para llenar horarios libres.
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {overlay.step === 3 && (
                      <div className="mgd-success">
                        <div className="su-ico">{I.check}</div>
                        <h3>¡Desafío enviado!</h3>
                        <p><strong>{parejaLabel(overlay.rival)}</strong> tiene 4 días para aceptar.<br />Si acepta, la cancha queda reservada automáticamente.</p>
                        {selectedSlot && (
                          <div className="su-card">
                            <div className="sc-row">{I.mapPin} {selectedSlot.club} · {selectedSlot.cancha}</div>
                            <div className="sc-row">{I.clock} {selectedSlot.hora} · {moneda(selectedSlot.precio)}</div>
                            <div className="sc-row">{I.check} Confirmación instantánea al aceptar</div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="sh-foot">
                    {overlay.step === 1 && <button className="mgd-bigbtn" onClick={advanceProponer}>{I.calendar} Elegir horario</button>}
                    {overlay.step === 2 && <button className="mgd-bigbtn" disabled={!selectedSlot} onClick={advanceProponer}>{I.swords} Enviar desafío</button>}
                    {overlay.step === 3 && <button className="mgd-bigbtn" onClick={closeOverlay}>{I.check} Listo</button>}
                  </div>
                </>
              )}

              {/* ── ACEPTAR DESAFÍO ── */}
              {overlay.kind === 'aceptar' && (
                <>
                  <div className="sh-head">
                    <div>
                      <div className="sh-title">⚔️ Desafío recibido</div>
                      <div className="sh-sub">{parejaLabel(overlay.desafio.rival)} te quiere enfrentar</div>
                    </div>
                    <button className="sh-close" onClick={closeOverlay}>{I.x}</button>
                  </div>
                  <div className="sh-body">
                    <RivalMini p={overlay.desafio.rival} />
                    <div style={{ background: 'var(--bg-soft)', borderRadius: 13, padding: '13px 14px', marginTop: 14 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)', marginBottom: 10 }}>Elegí el horario para jugar:</div>
                      <div className="mgd-slots">
                        {slotsDisponibles.slice(0, 4).map((s, i) => (
                          <button key={i} className={`mgd-slot ${selectedSlot === s ? 'on' : ''}`} onClick={() => setSelectedSlot(s)}>
                            <div className="sl-hora">{s.hora}</div>
                            <div className="sl-info">
                              <div className="sl-club">{s.club}</div>
                              <div className="sl-cancha">{s.cancha}</div>
                            </div>
                            <div className="sl-price">
                              <div className="sl-amt">{moneda(s.precio)}</div>
                              {s.valle && <div className="sl-valle">−30%</div>}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ background: '#faf7d0', borderRadius: 11, padding: '10px 13px', marginTop: 12, display: 'flex', gap: 9, alignItems: 'center' }}>
                      <div style={{ color: '#8a7400', flexShrink: 0 }}>{I.clock}</div>
                      <div style={{ fontSize: 12, color: '#8a7400', fontWeight: 600 }}>Tenés 4 días para aceptar o la posición se cede automáticamente.</div>
                    </div>
                  </div>
                  <div className="sh-foot" style={{ display: 'flex', gap: 10 }}>
                    <button className="mgd-bigbtn ghost" style={{ flex: '0 0 auto', width: 'auto', padding: '14px 18px' }} onClick={closeOverlay}>{I.x} Declinar</button>
                    <button className="mgd-bigbtn" style={{ flex: 1 }} disabled={!selectedSlot} onClick={() => aceptarDesafio(overlay.desafio)}>{I.check} Aceptar y reservar</button>
                  </div>
                </>
              )}

              {/* ── CARGAR RESULTADO ── */}
              {overlay.kind === 'resultado' && (
                <>
                  <div className="sh-head">
                    <div>
                      <div className="sh-title">📊 Cargar resultado</div>
                      <div className="sh-sub">vs. {parejaLabel(overlay.desafio.rival)}</div>
                    </div>
                    <button className="sh-close" onClick={closeOverlay}>{I.x}</button>
                  </div>
                  <div className="sh-body">
                    <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>¿Cuántos sets ganó cada pareja?</div>
                    <div className="mgd-scorebox">
                      <div className="mgd-scoreside">
                        <div className="ss-name">{parejaLabelAnd(miPareja)}</div>
                        <div className="ss-num">{overlay.mios}</div>
                        <div className="ss-ctrl">
                          <button className="ss-btn" onClick={() => setOverlay(o => o?.kind === 'resultado' ? { ...o, mios: Math.max(0, o.mios - 1) } : o)}>−</button>
                          <button className="ss-btn" onClick={() => setOverlay(o => o?.kind === 'resultado' ? { ...o, mios: Math.min(3, o.mios + 1) } : o)}>+</button>
                        </div>
                      </div>
                      <div className="mgd-scoresep">:</div>
                      <div className="mgd-scoreside">
                        <div className="ss-name">{parejaLabelAnd(overlay.desafio.rival)}</div>
                        <div className="ss-num">{overlay.rivales}</div>
                        <div className="ss-ctrl">
                          <button className="ss-btn" onClick={() => setOverlay(o => o?.kind === 'resultado' ? { ...o, rivales: Math.max(0, o.rivales - 1) } : o)}>−</button>
                          <button className="ss-btn" onClick={() => setOverlay(o => o?.kind === 'resultado' ? { ...o, rivales: Math.min(3, o.rivales + 1) } : o)}>+</button>
                        </div>
                      </div>
                    </div>
                    <div style={{ background: 'var(--bg-soft)', borderRadius: 11, padding: '10px 13px', display: 'flex', gap: 9, alignItems: 'center' }}>
                      <div style={{ color: 'var(--muted)', flexShrink: 0 }}>{I.info}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>El rival confirma el resultado. Si no lo hace en 24hs, se aprueba solo.</div>
                    </div>
                  </div>
                  <div className="sh-foot">
                    <button className="mgd-bigbtn" disabled={overlay.mios === overlay.rivales} onClick={() => confirmarResultado(overlay.desafio, overlay.mios, overlay.rivales)}>
                      {I.check} Confirmar resultado
                    </button>
                  </div>
                </>
              )}

              {/* ── RESULTADO CONFIRMADO ── */}
              {overlay.kind === 'confirmar_resultado' && overlay.desafio.resultado && (
                <>
                  <div className="sh-head">
                    <div>
                      <div className="sh-title">{overlay.desafio.resultado.gane ? '🏆 ¡Ganaron!' : '💪 Buen partido'}</div>
                      <div className="sh-sub">vs. {parejaLabel(overlay.desafio.rival)}</div>
                    </div>
                    <button className="sh-close" onClick={closeOverlay}>{I.x}</button>
                  </div>
                  <div className="sh-body">
                    <div className="mgd-success">
                      <div className="su-ico" style={{ background: overlay.desafio.resultado.gane ? 'var(--green-soft)' : 'var(--rose-soft)', color: overlay.desafio.resultado.gane ? 'var(--green-dark)' : 'var(--rose)' }}>
                        {overlay.desafio.resultado.gane ? I.trophy : I.star}
                      </div>
                      <h3>{overlay.desafio.resultado.miosSets} – {overlay.desafio.resultado.rivalSets}</h3>
                      <p>{overlay.desafio.resultado.gane ? 'Resultado enviado. Cuando el rival confirme, la escalera se actualiza.' : 'Buen partido. La revancha viene.'}</p>
                      <div className="su-card">
                        {overlay.desafio.resultado.gane && <div className="sc-row">{I.arrowUp} Podrías subir al puesto #{overlay.desafio.rival.posicion}</div>}
                        <div className="sc-row">{I.check} Resultado enviado al rival</div>
                        <div className="sc-row">{I.clock} Se auto-confirma en 24hs si no hay respuesta</div>
                      </div>
                    </div>
                  </div>
                  <div className="sh-foot">
                    <button className="mgd-bigbtn" onClick={closeOverlay}>{I.check} Volver al círculo</button>
                  </div>
                </>
              )}

              {/* ── INVITAR COMPAÑERO FIJO ── */}
              {overlay.kind === 'invitar' && (
                <>
                  <div className="sh-head">
                    <div>
                      <div className="sh-title">
                        {overlay.step === 1 && '🤝 Invitar compañero fijo'}
                        {overlay.step === 2 && 'Confirmar pareja'}
                        {overlay.step === 3 && '¡Solicitud enviada!'}
                      </div>
                      <div className="sh-sub">
                        {overlay.step === 1 && 'Buscá a tu compañero por nombre'}
                        {overlay.step === 2 && 'Revisá antes de enviar la solicitud'}
                        {overlay.step === 3 && `${overlay.jugadorSeleccionado?.nombre} recibió tu solicitud`}
                      </div>
                    </div>
                    <button className="sh-close" onClick={closeOverlay}>{I.x}</button>
                  </div>
                  <div className="sh-body">
                    <div className="mgd-steps">
                      <div className={`st ${overlay.step >= 1 ? 'on' : ''}`} />
                      <div className={`st ${overlay.step >= 2 ? 'on' : ''}`} />
                      <div className={`st ${overlay.step >= 3 ? 'on' : ''}`} />
                    </div>

                    {/* STEP 1: buscar jugador */}
                    {overlay.step === 1 && (
                      <>
                        <div className="mgd-flowlabel">¿Con quién jugás siempre?</div>
                        {/* buscador */}
                        <div style={{ position: 'relative', marginBottom: 14 }}>
                          <div style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', width: 17, height: 17 }}>{I.search}</div>
                          <input
                            style={{ width: '100%', border: '1.5px solid var(--border)', borderRadius: 12, padding: '11px 14px 11px 40px', fontSize: 14, outline: 'none', fontFamily: 'inherit', color: 'var(--ink)', background: '#fff' }}
                            placeholder="Nombre o teléfono…"
                            value={busqueda}
                            onChange={e => setBusqueda(e.target.value)}
                            autoFocus
                          />
                        </div>

                        {/* resultados de búsqueda */}
                        {busqueda.length >= 2 && resultadosFiltrados.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {resultadosFiltrados.map(j => (
                              <button
                                key={j.id}
                                onClick={() => setOverlay({ ...overlay, step: 2, jugadorSeleccionado: j })}
                                style={{ display: 'flex', alignItems: 'center', gap: 13, background: '#fff', border: '1.5px solid var(--border)', borderRadius: 13, padding: '12px 14px', textAlign: 'left' }}
                              >
                                <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'var(--marino)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 15, flexShrink: 0 }}>{j.avatar}</div>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>{j.nombreCompleto}</div>
                                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{categoriaLabel(j.categoria)} · {j.zona}</div>
                                </div>
                                <div style={{ color: 'var(--green)', flexShrink: 0 }}>{I.userPlus}</div>
                              </button>
                            ))}
                          </div>
                        ) : busqueda.length >= 2 ? (
                          <div style={{ textAlign: 'center', padding: '28px 16px', color: 'var(--muted)', fontSize: 13 }}>
                            <div style={{ marginBottom: 8 }}>Sin resultados para "{busqueda}"</div>
                            <div style={{ fontSize: 12 }}>Podés invitarlo por link para que se sume a MatchGo</div>
                          </div>
                        ) : (
                          <div style={{ background: 'var(--bg-soft)', borderRadius: 13, padding: '14px 16px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                            <div style={{ color: 'var(--marino)', flexShrink: 0, marginTop: 1 }}>{I.info}</div>
                            <div style={{ fontSize: 12.5, color: 'var(--body)', lineHeight: 1.5 }}>
                              <strong style={{ color: 'var(--ink)' }}>Pareja fija = una relación declarada.</strong>
                              {' '}Cada jugador puede tener solo UNA pareja activa a la vez. El historial y rating son compartidos.
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {/* STEP 2: confirmar */}
                    {overlay.step === 2 && overlay.jugadorSeleccionado && (
                      <>
                        <div className="mgd-flowlabel">Vas a invitar a:</div>
                        <div style={{ background: 'var(--bg-soft)', borderRadius: 14, padding: '16px', marginBottom: 14 }}>
                          {/* preview de la futura pareja */}
                          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
                            {[miJugador, overlay.jugadorSeleccionado].map((j, i) => (
                              <div key={j.id} style={{ width: 56, height: 56, borderRadius: '50%', background: i === 0 ? 'var(--marino)' : '#16306f', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 18, border: '3px solid #fff', marginLeft: i === 0 ? 0 : -16, boxShadow: '0 2px 8px rgba(0,0,0,.15)' }}>{j.avatar}</div>
                            ))}
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>{miJugador.nombre} & {overlay.jugadorSeleccionado.nombre}</div>
                            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{categoriaLabel(miJugador.categoria)} · Pareja nueva · 0 partidos</div>
                          </div>
                        </div>
                        <div style={{ background: 'var(--green-soft)', borderRadius: 11, padding: '11px 13px', display: 'flex', gap: 9, alignItems: 'center' }}>
                          <div style={{ color: 'var(--green-dark)', flexShrink: 0 }}>{I.link2}</div>
                          <div style={{ fontSize: 12.5, color: 'var(--green-dark)', fontWeight: 600 }}>
                            {overlay.jugadorSeleccionado.nombre} tiene que aceptar para activar la pareja.
                          </div>
                        </div>
                        <div style={{ background: 'var(--bg-soft)', borderRadius: 11, padding: '11px 13px', marginTop: 10, display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                          <div style={{ color: 'var(--muted)', flexShrink: 0, marginTop: 1 }}>{I.info}</div>
                          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
                            Una vez activa, la pareja tendrá su propio rating y podrá desafiar y ser desafiada en el círculo.
                          </div>
                        </div>
                      </>
                    )}

                    {/* STEP 3: éxito */}
                    {overlay.step === 3 && overlay.jugadorSeleccionado && (
                      <div className="mgd-success">
                        <div className="su-ico">{I.userPlus}</div>
                        <h3>¡Solicitud enviada!</h3>
                        <p>
                          <strong>{overlay.jugadorSeleccionado.nombreCompleto}</strong> recibió tu invitación.<br />
                          Cuando acepte, la pareja queda activa y entran al círculo juntos.
                        </p>
                        <div className="su-card">
                          <div className="sc-row">{I.check} Notificación enviada a {overlay.jugadorSeleccionado.nombre}</div>
                          <div className="sc-row">{I.clock} La solicitud expira en 7 días si no responde</div>
                          <div className="sc-row">{I.info} Podés cancelar la solicitud desde "Mi pareja"</div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="sh-foot">
                    {overlay.step === 1 && (
                      <button className="mgd-bigbtn" style={{ background: 'var(--bg-soft)', color: 'var(--muted)', border: '1.5px solid var(--border)', boxShadow: 'none' }} onClick={closeOverlay}>
                        Cancelar
                      </button>
                    )}
                    {overlay.step === 2 && (
                      <div style={{ display: 'flex', gap: 10 }}>
                        <button className="mgd-bigbtn ghost" style={{ flex: '0 0 auto', width: 'auto', padding: '14px 18px' }} onClick={() => setOverlay({ ...overlay, step: 1 })}>Atrás</button>
                        <button className="mgd-bigbtn" style={{ flex: 1 }} onClick={() => setOverlay({ ...overlay, step: 3 })}>{I.userPlus} Enviar solicitud</button>
                      </div>
                    )}
                    {overlay.step === 3 && (
                      <button className="mgd-bigbtn" onClick={closeOverlay}>{I.check} Listo</button>
                    )}
                  </div>
                </>
              )}

              {/* ── EDITAR APODO (opcional) ── */}
              {overlay.kind === 'apodo' && (
                <>
                  <div className="sh-head">
                    <div>
                      <div className="sh-title">✏️ Apodo de la pareja</div>
                      <div className="sh-sub">Opcional — solo para el círculo</div>
                    </div>
                    <button className="sh-close" onClick={closeOverlay}>{I.x}</button>
                  </div>
                  <div className="sh-body">
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>Apodo (opcional)</div>
                      <input
                        style={{ width: '100%', border: '1.5px solid var(--border)', borderRadius: 12, padding: '12px 14px', fontSize: 15, outline: 'none', fontFamily: 'inherit', color: 'var(--ink)' }}
                        placeholder='Ej: "Los Cracks de Salta"…'
                        value={apodoDraft}
                        onChange={e => setApodoDraft(e.target.value)}
                        maxLength={30}
                      />
                      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6, textAlign: 'right' }}>{apodoDraft.length}/30</div>
                    </div>
                    <div style={{ background: 'var(--bg-soft)', borderRadius: 12, padding: '12px 14px', display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                      <div style={{ color: 'var(--muted)', flexShrink: 0, marginTop: 1 }}>{I.info}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--body)' }}>
                        El apodo es solo un alias para el círculo. La identidad real de la pareja siempre son los <strong>dos jugadores</strong>.
                      </div>
                    </div>
                  </div>
                  <div className="sh-foot" style={{ display: 'flex', gap: 10 }}>
                    {apodoGuardado && (
                      <button className="mgd-bigbtn ghost" style={{ flex: '0 0 auto', width: 'auto', padding: '14px 18px' }} onClick={() => { setApodoGuardado(''); closeOverlay(); }}>
                        Quitar apodo
                      </button>
                    )}
                    <button className="mgd-bigbtn" style={{ flex: 1 }} onClick={() => { setApodoGuardado(apodoDraft.trim()); closeOverlay(); }}>
                      {I.check} Guardar
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="mgd-foot">
        <strong>Prototipo visual MatchGo</strong> · Datos mock, sin backend · Parejas fijas sin nombre obligatorio
      </div>
    </div>
  );
}

// ─── Rival mini (reutilizable en varios overlays) ─────────────────────────────
function RivalMini({ p }: { p: Pareja }) {
  return (
    <div className="mgd-rivalmini">
      <ParejaAvs p={p} size={40} />
      <div>
        <div className="rm-apodo">{parejaLabel(p)}</div>
        <div className="rm-meta">Puesto #{p.posicion} · {categoriaLabel(p.categoria)} · {p.rating} pts</div>
      </div>
    </div>
  );
}

// ─── Tab: Círculo / Escalera ──────────────────────────────────────────────────
function TabCirculo({ onDesafiar }: { onDesafiar: (p: Pareja) => void }) {
  const myPos = miPareja.posicion;
  const reachableMin = myPos - 2;

  return (
    <div>
      <div className="mgd-mypos">
        <div className="mp-row">
          <div className="mp-rank">
            <span className="hash">#</span>
            <span className="num">{miPareja.posicion}</span>
          </div>
          <div className="mp-info">
            <div className="mp-apodo">{parejaLabelAnd(miPareja)}</div>
            <div className="mp-meta">{miPareja.pj} partidos · {miPareja.pg}G {miPareja.pj - miPareja.pg}P · {categoriaLabel(miPareja.categoria)}</div>
            <div className="mp-streak">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              {miPareja.racha > 0 ? `${miPareja.racha} victorias seguidas` : `${Math.abs(miPareja.racha)} derrotas seguidas`}
            </div>
          </div>
        </div>
        <button className="mp-cta" onClick={() => onDesafiar(escalera[myPos - 3]!)}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 17.5L3 6V3h3l11.5 11.5"/><path d="M13 19l6-6"/><path d="M16 16l4 4"/><path d="M19 21l2-2"/><path d="M14.5 6.5L18 3h3v3l-3.5 3.5"/><path d="M5 14l5 5"/><path d="M3 19l2 2"/></svg>
          Desafiar a {escalera[myPos - 3]?.jugadores[0].nombre} + {escalera[myPos - 3]?.jugadores[1].nombre}
        </button>
      </div>

      <div className="mgd-stitle">
        <h2>Escalera del círculo</h2>
        <span className="hint">Top {escalera.length}</span>
      </div>

      <div className="mgd-ladder">
        {escalera.map((p) => {
          const isMe = p.esMia;
          const isReachable = !isMe && p.posicion >= reachableMin && p.posicion < myPos;
          let podiumClass = '';
          if (p.posicion === 1) podiumClass = 'podium1';
          if (p.posicion === 2) podiumClass = 'podium2';
          if (p.posicion === 3) podiumClass = 'podium3';
          const showDivider = p.posicion === reachableMin;

          return (
            <div key={p.id}>
              {showDivider && (
                <div className="mgd-divider">
                  <span>↑ Podés desafiar hasta acá</span>
                </div>
              )}
              <div className={`mgd-rung ${isMe ? 'mine' : ''} ${isReachable ? 'reachable' : ''} ${podiumClass}`}>
                <div className="r-pos">
                  {p.posicion === 1 ? '🥇' : p.posicion === 2 ? '🥈' : p.posicion === 3 ? '🥉' : `#${p.posicion}`}
                </div>
                <ParejaAvs p={p} size={32} />
                <div className="r-main">
                  {/* identidad = nombres, no apodo */}
                  <div className="r-apodo">{p.jugadores[0].nombre} · {p.jugadores[1].nombre}</div>
                  <div className="r-sub">
                    <span className="r-cat">{categoriaLabel(p.categoria)}</span>
                    {' '}· {rachaLabel(p.racha)}
                  </div>
                </div>
                {isMe ? (
                  <div className="r-meplabel">Vos</div>
                ) : isReachable ? (
                  <button className="r-action" onClick={() => onDesafiar(p)}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 17.5L3 6V3h3l11.5 11.5"/><path d="M13 19l6-6"/><path d="M16 16l4 4"/><path d="M19 21l2-2"/><path d="M14.5 6.5L18 3h3v3l-3.5 3.5"/><path d="M5 14l5 5"/><path d="M3 19l2 2"/></svg>
                    Desafiar
                  </button>
                ) : (
                  <div className="r-action ghost" style={{ fontSize: 11, cursor: 'default' }}>
                    {p.posicion < myPos - 2 ? 'Fuera rango' : 'Abajo'}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Tab: Mis desafíos ────────────────────────────────────────────────────────
function TabDesafios({ desafios, onAceptar, onCargarResultado }: {
  desafios: Desafio[];
  onAceptar: (d: Desafio) => void;
  onCargarResultado: (d: Desafio) => void;
}) {
  const activos = desafios.filter(d => d.estado !== 'jugado');
  const jugados = desafios.filter(d => d.estado === 'jugado');

  return (
    <div>
      <div className="mgd-stitle">
        <h2>Mis desafíos</h2>
        <span className="hint">{activos.length} activos</span>
      </div>
      {activos.length === 0 && (
        <div className="mgd-empty">
          <div className="e-ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 17.5L3 6V3h3l11.5 11.5"/><path d="M13 19l6-6"/></svg>
          </div>
          <h3>Sin desafíos activos</h3>
          <p>Andá al Círculo y desafiá a las parejas que tenés arriba.</p>
        </div>
      )}
      <div className="mgd-dlist">
        {activos.map(d => <DesafioCard key={d.id} d={d} onAceptar={onAceptar} onCargarResultado={onCargarResultado} />)}
      </div>
      {jugados.length > 0 && (
        <>
          <div className="mgd-stitle" style={{ paddingTop: 8 }}>
            <h2>Historial</h2>
            <span className="hint">{jugados.length} jugados</span>
          </div>
          <div className="mgd-dlist">
            {jugados.map(d => <DesafioCard key={d.id} d={d} onAceptar={onAceptar} onCargarResultado={onCargarResultado} />)}
          </div>
        </>
      )}
    </div>
  );
}

function DesafioCard({ d, onAceptar, onCargarResultado }: {
  d: Desafio;
  onAceptar: (d: Desafio) => void;
  onCargarResultado: (d: Desafio) => void;
}) {
  return (
    <div className={`mgd-dcard ${d.estado}`}>
      <div className="dc-strip" />
      <div className="dc-body">
        <div className="dc-top">
          <div className={`dc-state ${d.estado}`}>{estadoLabel(d.estado)}</div>
          <div className="dc-vs">puesto #{d.rival.posicion}</div>
        </div>
        <div className="dc-rival">
          <ParejaAvs p={d.rival} size={36} />
          <div className="dc-rinfo">
            {/* identidad = nombres reales */}
            <div className="dc-apodo">{parejaLabel(d.rival)}</div>
            <div className="dc-rmeta">{categoriaLabel(d.rival.categoria)} · {d.rival.rating} pts</div>
          </div>
        </div>
        {d.club && (
          <div className="dc-when">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            {d.fecha} · {d.hora}
            <span className="sep">·</span>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            {d.club}
          </div>
        )}
        {d.resultado && (
          <div className="dc-result">
            <div className="dc-score">{d.resultado.miosSets} – {d.resultado.rivalSets}</div>
            <div className={`dc-outcome ${d.resultado.gane ? 'win' : 'loss'}`}>
              {d.resultado.gane ? '✓ Ganaron' : '✗ Perdieron'}
            </div>
          </div>
        )}
        <div className="dc-actions">
          {d.estado === 'recibido' && (
            <>
              <button className="dc-btn ghost" onClick={() => {}}>Declinar</button>
              <button className="dc-btn primary" onClick={() => onAceptar(d)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Aceptar
              </button>
            </>
          )}
          {d.estado === 'enviado' && <button className="dc-btn ghost" style={{ cursor: 'default' }}>Esperando respuesta…</button>}
          {d.estado === 'agendado' && (
            <button className="dc-btn dark">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              Ver detalles
            </button>
          )}
          {d.estado === 'a_confirmar' && (
            <button className="dc-btn primary" onClick={() => onCargarResultado(d)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              Cargar resultado
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Mi pareja ───────────────────────────────────────────────────────────
function TabPareja({ apodo, onInvitar: _onInvitar, onEditarApodo }: {
  apodo: string;
  onInvitar: () => void;
  onEditarApodo: () => void;
}) {
  const winPct = Math.round((miPareja.pg / miPareja.pj) * 100);

  return (
    <div>
      {/* hero — identidad = jugadores, apodo es secundario */}
      <div className="mgd-profile-hero">
        <div className="ph-avs">
          {miPareja.jugadores.map((j, i) => (
            <div key={j.id} style={{
              width: 62, height: 62, borderRadius: '50%',
              background: i === 0 ? '#1c3a82' : '#234494',
              border: '3px solid rgba(255,255,255,.2)',
              marginLeft: i === 0 ? 0 : -18,
              display: 'grid', placeItems: 'center',
              fontSize: 20, fontWeight: 800, color: '#fff',
              boxShadow: '0 4px 12px rgba(0,0,0,.25)',
            }}>{j.avatar}</div>
          ))}
        </div>

        {/* nombres como identidad primaria */}
        <div className="ph-apodo">{miPareja.jugadores[0].nombre}</div>
        <div style={{ color: '#9fb0d4', fontSize: 13, fontWeight: 600, marginTop: 2 }}>
          + {miPareja.jugadores[1].nombre}
        </div>

        {/* apodo opcional — secundario y editable */}
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
          {apodo ? (
            <button onClick={onEditarApodo} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,.12)', color: '#fff', border: '1px solid rgba(255,255,255,.2)', borderRadius: 999, padding: '5px 12px', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>
              "{apodo}"
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
          ) : (
            <button onClick={onEditarApodo} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', color: 'rgba(255,255,255,.45)', border: '1px dashed rgba(255,255,255,.25)', borderRadius: 999, padding: '5px 12px', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Agregar apodo (opcional)
            </button>
          )}
        </div>

        <div className="ph-cat">{categoriaLabel(miPareja.categoria)} · Puesto #{miPareja.posicion}</div>
      </div>

      {/* stats */}
      <div className="mgd-stats">
        <div className="mgd-stat">
          <div className="s-num">{miPareja.pj}</div>
          <div className="s-lbl">Partidos</div>
        </div>
        <div className="mgd-stat">
          <div className="s-num" style={{ color: 'var(--emerald)' }}>{winPct}%</div>
          <div className="s-lbl">Efectividad</div>
        </div>
        <div className="mgd-stat">
          <div className="s-num" style={{ color: miPareja.racha > 0 ? 'var(--emerald)' : 'var(--rose)' }}>
            {miPareja.racha > 0 ? `+${miPareja.racha}` : miPareja.racha}
          </div>
          <div className="s-lbl">Racha</div>
        </div>
      </div>

      {/* rating */}
      <div className="mgd-rating-row">
        <div className="rr-num">{miPareja.rating}</div>
        <div className="rr-info">
          <div className="rr-t">Rating MatchGo</div>
          <div className="rr-d">Sube con victorias · baja con derrotas</div>
        </div>
      </div>

      {/* info de los jugadores */}
      <div style={{ margin: '0 16px 14px', background: '#fff', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
        {miPareja.jugadores.map((j, i) => (
          <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '13px 16px', borderBottom: i === 0 ? '1px solid var(--border)' : 'none' }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: i === 0 ? 'var(--marino)' : '#16306f', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>{j.avatar}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--ink)' }}>{j.nombreCompleto}</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>{categoriaLabel(j.categoria)} · {j.zona}</div>
            </div>
            {i === 0 && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--green-dark)', background: 'var(--green-soft)', padding: '3px 8px', borderRadius: 7 }}>Vos</div>}
          </div>
        ))}
      </div>

      {/* historial */}
      <div className="mgd-hist">
        <h3>Últimos partidos</h3>
        {[
          { rival: 'Ramiro A. + Bruno V.', fecha: 'Dom 7 jun', score: '2-1', win: true, pts: +24 },
          { rival: 'Eze P. + Maxi S.', fecha: 'Mié 3 jun', score: '1-2', win: false, pts: -18 },
          { rival: 'Lauti M. + Joaco T.', fecha: 'Sáb 30 may', score: '2-0', win: true, pts: +21 },
          { rival: 'Ani C. + Vale D.', fecha: 'Mar 27 may', score: '1-2', win: false, pts: -22 },
          { rival: 'Tomi G. + Santi R.', fecha: 'Dom 24 may', score: '2-1', win: true, pts: +19 },
        ].map((h, i) => (
          <div key={i} className="mgd-hrow">
            <div className={`h-dot ${h.win ? 'win' : 'loss'}`} />
            <div className="h-main">
              <div className="h-rival">vs. {h.rival}</div>
              <div className="h-date">{h.fecha}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="h-score">{h.score}</div>
              <div className={`h-pts ${h.win ? 'win' : 'loss'}`}>{h.pts > 0 ? `+${h.pts}` : h.pts} pts</div>
            </div>
          </div>
        ))}
      </div>

      {/* acción: disolver pareja */}
      <div style={{ padding: '0 16px 28px' }}>
        <button style={{ width: '100%', padding: '13px', borderRadius: 13, border: '1.5px solid var(--border)', background: '#fff', color: 'var(--rose)', fontSize: 13.5, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
          Disolver pareja
        </button>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', textAlign: 'center', marginTop: 8 }}>
          El historial y rating quedan como antecedente · No se borra nada
        </div>
      </div>
    </div>
  );
}
