import { distribuirDeudaPonderada, ParticipantDebt } from '../src/features/reservas/utils/cuentaTurno';

const totalDebt = 49000;
const participants: ParticipantDebt[] = [
  { id: 1, paid: 6000, baseWeight: 11167 }, // J1
  { id: 2, paid: 10000, baseWeight: 11167 }, // J2
  { id: 3, paid: 0, baseWeight: 11167 }, // J3
  { id: 4, paid: 20000, baseWeight: 11167 }, // J4
  { id: 5, paid: 0, baseWeight: 2167 }, // I1
  { id: 6, paid: 0, baseWeight: 2167 }, // I2
];

const saldos = distribuirDeudaPonderada(totalDebt, participants);
console.log('Saldos Combinados:', saldos);
