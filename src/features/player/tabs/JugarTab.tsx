export function JugarTab() {
  return (
    <div style={{ padding: 16, height: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* ── Cabecera ── */}
      <p style={{ fontSize: 13, color: 'var(--mgp-muted)', marginBottom: 20, lineHeight: 1.5 }}>
        Encontrá gente de tu comunidad para jugar. Podés anotarte a una cancha que ya está reservada
        o publicar que tenés turno y buscás compañeros.
      </p>

      {/* ── Filtro de nivel (visual, próximamente funcional) ── */}
      <div className="mgp-chips" style={{ marginBottom: 20 }}>
        {(['Todos', '5ta', '6ta', '7ta', 'Abierto']).map(n => (
          <button
            key={n}
            className={`mgp-chip${n === 'Todos' ? ' active' : ''}`}
            disabled
          >
            {n}
          </button>
        ))}
      </div>

      {/* ── Empty state ── */}
      <div className="mgp-empty-state" style={{ flex: 1 }}>
        <div className="mgp-empty-state-icon">🤝</div>
        <div className="mgp-empty-state-title">Sin partidos disponibles</div>
        <div className="mgp-empty-state-sub">
          Cuando alguien de tu zona publique una cancha y busque jugadores, va a aparecer acá.
        </div>
      </div>

      {/* ── CTA publicar ── */}
      <div style={{ paddingBottom: 16 }}>
        <button
          className="mgp-btn mgp-btn-full mgp-btn-marino"
          style={{ gap: 8, opacity: 0.5, cursor: 'not-allowed' }}
          disabled
        >
          🎾 Tengo cancha, busco jugadores <span style={{ fontSize: 11 }}>(próximamente)</span>
        </button>
      </div>

    </div>
  );
}
