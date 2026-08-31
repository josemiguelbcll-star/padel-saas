import { calcularSaldosPersonas, calcularDesgloseCuenta } from '../src/features/reservas/utils/cuentaTurno';

console.log('=== TEST 1: Caso Martin (Paga 4.000 de 8.000 y se redistribuye) ===');
// 3 jugadores, cancha 24.000. Martin pagó 4.000 y se fija su cuota en 4.000.
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

console.log('\n=== TEST 2: Cancha 24.000 + Consumos 4.000 con 3 jugadores + 1 invitado ===');
// Martin pagó 4.000 y se fija su cuota en 4.000.
const res2 = calcularSaldosPersonas({
  personas: [
    { id: 1, tipo: 'jugador', es_titular: true }, // Juan
    { id: 2, tipo: 'jugador', cuota_fija: 4000 },  // Martin
    { id: 3, tipo: 'jugador' },                   // Jose
    { id: 4, tipo: 'invitado' },                  // Carlos
  ],
  pagos: [
    { reserva_jugador_id: 2, monto_alquiler: 4000, monto_consumo: 0, creado_en: '2026-08-31T10:00:00Z' },
  ],
  consumos: [
    { subtotal: 4000, tipo_reparto: 'general', creado_en: '2026-08-31T09:00:00Z' },
  ],
  montoAlquiler: 24000,
});

console.log(res2.map(r => ({ id: r.reservaJugadorId, tipo: r.tipo, parteTotal: r.parteTotal, yaPagado: r.yaPagadoTotal, saldo: r.saldo, estado: r.estado })));

console.log('\n=== TEST 3: Invitado paga 500 de consumo de 1.000 y se redistribuye ===');
const res3 = calcularSaldosPersonas({
  personas: [
    { id: 1, tipo: 'jugador', es_titular: true }, // Juan
    { id: 2, tipo: 'jugador' },                   // Martin
    { id: 3, tipo: 'jugador' },                   // Jose
    { id: 4, tipo: 'invitado', cuota_fija: 500 }, // Carlos invitado saldado con 500
  ],
  pagos: [
    { reserva_jugador_id: 4, monto_alquiler: 0, monto_consumo: 500, creado_en: '2026-08-31T10:00:00Z' },
  ],
  consumos: [
    { subtotal: 4000, tipo_reparto: 'general', creado_en: '2026-08-31T09:00:00Z' },
  ],
  montoAlquiler: 24000,
});

console.log(res3.map(r => ({ id: r.reservaJugadorId, tipo: r.tipo, parteTotal: r.parteTotal, yaPagado: r.yaPagadoTotal, saldo: r.saldo, estado: r.estado })));
