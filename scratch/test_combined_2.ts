import { distribuirDeudaPonderada, ParticipantDebt } from '../src/features/reservas/utils/cuentaTurno';

const combinedParticipants: ParticipantDebt[] = [
  // J1 paid 6000. Base weight = 9000 (alq) + 2600 (con) = 11600
  { id: 1, paid: 6000, baseWeight: 11600 },
  // J2 paid 10000. Base weight = 11600
  { id: 2, paid: 10000, baseWeight: 11600 },
  // J3 paid 0. Base weight = 11600
  { id: 3, paid: 0, baseWeight: 11600 },
  // J4 paid 20000. Base weight = 9000 (excluded from consumos)
  { id: 4, paid: 20000, baseWeight: 9000 },
  // I1 paid 0. Base weight = 2600
  { id: 5, paid: 0, baseWeight: 2600 },
  // I2 paid 0. Base weight = 2600
  { id: 6, paid: 0, baseWeight: 2600 },
];

const totalDebt = 36000 + 13000; // 49000
const saldosCombinados = distribuirDeudaPonderada(totalDebt, combinedParticipants);

console.log('Saldos Combinados (con J4 excluido de consumos):', saldosCombinados);
