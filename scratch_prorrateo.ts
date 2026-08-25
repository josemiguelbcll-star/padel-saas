interface Participant { id: number; paid: number; }
function distributeDebt(totalDebt: number, participants: Participant[]): Record<number, number> {
  let active = [...participants];
  let remainingDebt = totalDebt;
  
  while (active.length > 0) {
    const quota = remainingDebt / active.length;
    // Find people who overpaid compared to the current average quota
    const overpayers = active.filter(p => p.paid >= quota);
    
    if (overpayers.length === 0) {
      // No one overpaid, everyone owes (quota - paid)
      break;
    }
    
    // Remove overpayers from active pool and subtract their payments from remaining debt
    for (const p of overpayers) {
      remainingDebt -= p.paid;
    }
    active = active.filter(p => p.paid < quota);
  }
  
  // Calculate final saldos
  const saldos: Record<number, number> = {};
  // For active people, they owe (quota - paid)
  const finalQuota = active.length > 0 ? remainingDebt / active.length : 0;
  for (const p of active) {
    saldos[p.id] = Math.ceil(finalQuota - p.paid); // Redondeo hacia arriba a favor del club
  }
  // For overpayers (who were removed), they owe 0
  for (const p of participants) {
    if (saldos[p.id] === undefined) {
      saldos[p.id] = 0;
    }
  }
  
  return saldos;
}

console.log("Test 1: 40k, P1 pays 30k");
console.log(distributeDebt(40000, [
  { id: 1, paid: 30000 },
  { id: 2, paid: 0 },
  { id: 3, paid: 0 },
  { id: 4, paid: 0 }
]));

console.log("Test 2: 40k, P1 pays 30k, P2 pays 10k");
console.log(distributeDebt(40000, [
  { id: 1, paid: 30000 },
  { id: 2, paid: 10000 },
  { id: 3, paid: 0 },
  { id: 4, paid: 0 }
]));

console.log("Test 3: 40k, P1 pays 12k");
console.log(distributeDebt(40000, [
  { id: 1, paid: 12000 },
  { id: 2, paid: 0 },
  { id: 3, paid: 0 },
  { id: 4, paid: 0 }
]));
