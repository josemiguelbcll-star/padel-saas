export function dividirMontoEnCuotas(total: number, cantidad: number): number[] {
  if (!Number.isFinite(total) || total < 0) {
    throw new Error('El total a dividir debe ser un monto válido igual o mayor a 0.');
  }
  if (!Number.isInteger(cantidad) || cantidad < 1) {
    throw new Error('La cantidad de cuotas debe ser un entero mayor a 0.');
  }

  const totalCentavos = Math.round(total * 100);
  const centavosBase = Math.floor(totalCentavos / cantidad);
  const centavosExtra = totalCentavos % cantidad;

  return Array.from({ length: cantidad }, (_, index) =>
    (centavosBase + (index < centavosExtra ? 1 : 0)) / 100,
  );
}
