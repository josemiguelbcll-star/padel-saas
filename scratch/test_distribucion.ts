import { distribuirDeudaPonderada, ParticipantDebt } from '../src/features/reservas/utils/cuentaTurno';

const alquilerParticipants: ParticipantDebt[] = [
  { id: 1, paid: 6000, baseWeight: 9000 },
  { id: 2, paid: 10000, baseWeight: 9000 },
  { id: 3, paid: 0, baseWeight: 9000 },
  { id: 4, paid: 20000, baseWeight: 9000 },
];

const saldosAlquiler = distribuirDeudaPonderada(36000, alquilerParticipants);

console.log('Saldos Alquiler:', saldosAlquiler);

// They all have paidConsumo = 0. J4 is excluded from consumos because he was "saldada" before consumos were added.
const consumoParticipants: ParticipantDebt[] = [
  { id: 1, paid: 0, baseWeight: 2600 }, // J1
  { id: 2, paid: 0, baseWeight: 2600 }, // J2
  { id: 3, paid: 0, baseWeight: 2600 }, // J3
  { id: 4, paid: 0, baseWeight: 0 },    // J4
  { id: 5, paid: 0, baseWeight: 2600 }, // I1
  { id: 6, paid: 0, baseWeight: 2600 }, // I2
];

const saldosConsumo = distribuirDeudaPonderada(13000, consumoParticipants);

console.log('Saldos Consumo:', saldosConsumo);
