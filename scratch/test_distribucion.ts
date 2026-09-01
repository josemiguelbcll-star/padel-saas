import { calcularSaldosPersonas, calcularDesgloseCuenta } from '../src/features/reservas/utils/cuentaTurno';

console.log('=== TEST 1: Caso Martin (Paga 4.000 de 8.000 y se redistribuye) ===');
const res1 = calcularSaldosPersonas({
  personas: [
    { id: 1, tipo: 'jugador', es_titular: true }, // Juan
    { id: 2, tipo: 'jugador', cuota_fija: 4000 },  // Martin (saldado con 4000)
    { id: 3, tipo: 'jugador' },                   // Jose Miguel
  ],
  pagos: [
    { reserva_jugador_id: 2, monto_alquiler: 4000, monto_consumo: 0, creado_en: '2026-08-31T10:00:00Z' },
  ],
  consumos: [],
  montoAlquiler: 24000,
});

console.log(res1.map(r => ({ id: r.reservaJugadorId, parteTotal: r.parteTotal, yaPagado: r.yaPagadoTotal, saldo: r.saldo, estado: r.estado })));

console.log('\n=== TEST 4: Caso del Screenshot (Jugador paga 40.000 superando su saldo individual) ===');
// Cancha 60.000, consumos 36.000 -> Total 96.000
// Jugador 3 pagó 10.000 con cuota fija 10.000.
// Jugador 1 paga 40.000 (su saldo era 21.000, paga 40.000).
const res4 = calcularSaldosPersonas({
  personas: [
    { id: 1, tipo: 'jugador', es_titular: true }, // Jugador 1 (paga 40.000)
    { id: 2, tipo: 'jugador' },                   // Jugador 2
    { id: 3, tipo: 'jugador', cuota_fija: 10000 },// Jugador 3 (ya pagó 10.000)
    { id: 4, tipo: 'jugador' },                   // Jugador 4
    { id: 5, tipo: 'invitado' },                  // Invitado 1
    { id: 6, tipo: 'invitado' },                  // Invitado 2
  ],
  pagos: [
    { reserva_jugador_id: 3, monto_alquiler: 10000, monto_consumo: 0, creado_en: '2026-08-31T10:00:00Z' },
    { reserva_jugador_id: 1, monto_alquiler: 35666, monto_consumo: 4334, creado_en: '2026-08-31T10:05:00Z' }, // Jugador 1 pagó 40.000
  ],
  consumos: [
    { subtotal: 36000, tipo_reparto: 'general', creado_en: '2026-08-31T09:00:00Z' },
  ],
  montoAlquiler: 60000,
});

console.log(res4.map(r => ({ id: r.reservaJugadorId, tipo: r.tipo, parteTotal: r.parteTotal, yaPagado: r.yaPagadoTotal, saldo: r.saldo, estado: r.estado })));
const totalSaldos = res4.reduce((acc, r) => acc + r.saldo, 0);
console.log('Total saldos pendientes tras pago de 40.000:', totalSaldos, '(esperado: 46.000)');
