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

console.log("Alquiler Test (User's Current Screenshot):");
console.log(distributeDebtWeighted(48000, [
  { id: 1, paid: 20000, baseWeight: 12000 },
  { id: 2, paid: 20000, baseWeight: 12000 },
  { id: 3, paid: 0, baseWeight: 12000 },
  { id: 4, paid: 0, baseWeight: 12000 }
]));
