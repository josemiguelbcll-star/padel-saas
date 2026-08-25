interface Participant { id: number; paid: number; baseWeight: number; }
function distributeDebtWeighted(totalDebt: number, participants: Participant[]): Record<number, number> {
  let active = [...participants];
  let remainingDebt = totalDebt;
  
  while (active.length > 0) {
    const totalWeight = active.reduce((sum, p) => sum + p.baseWeight, 0);
    if (totalWeight === 0) break;
    
    const quotaPerWeight = remainingDebt / totalWeight;
    const overpayers = active.filter(p => p.paid >= quotaPerWeight * p.baseWeight);
    
    if (overpayers.length === 0) break;
    
    for (const p of overpayers) {
      remainingDebt -= p.paid;
    }
    active = active.filter(p => p.paid < quotaPerWeight * p.baseWeight);
  }
  
  const saldos: Record<number, number> = {};
  const totalWeight = active.reduce((sum, p) => sum + p.baseWeight, 0);
  const finalQuotaPerWeight = totalWeight > 0 ? remainingDebt / totalWeight : 0;
  
  for (const p of active) {
    saldos[p.id] = Math.max(0, Math.ceil((finalQuotaPerWeight * p.baseWeight) - p.paid));
  }
  for (const p of participants) {
    if (saldos[p.id] === undefined) {
      saldos[p.id] = 0;
    }
  }
  return saldos;
}

console.log("Alquiler Test (User's Example):");
console.log(distributeDebtWeighted(40000, [
  { id: 1, paid: 30000, baseWeight: 1 },
  { id: 2, paid: 10000, baseWeight: 1 },
  { id: 3, paid: 0, baseWeight: 1 },
  { id: 4, paid: 0, baseWeight: 1 }
]));

console.log("Consumo Test:");
console.log(distributeDebtWeighted(10000, [
  { id: 1, paid: 10000, baseWeight: 6000 }, // Jugador (60%)
  { id: 2, paid: 0, baseWeight: 4000 },    // Invitado (40%)
]));
