import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const workbook = XLSX.utils.book_new();

// Sheet 1: BEBIDAS DOMO
const bebidasDomoData = [
  ['Producto', 'Stock', 'Costo', 'Notas', 'Precio', 'Categoria'],
  ['Coca Cola 500ml', 24, 800, '', 1500, 'bebidas'],
  ['Agua Mineral 500ml', 30, 500, '', 1000, 'bebidas'],
  ['Powerade 500ml', 15, 900, '', 1800, 'bebidas'],
  ['Cerveza Heineken 473ml', 20, 1200, '', 2500, 'bebidas'],
  ['Gatorade 500ml', 18, 850, '', 1700, 'bebidas'],
  ['Speed Unlimited 250ml', 25, 950, '', 2000, 'bebidas'],
  ['Red Bull 250ml', 12, 1400, '', 2800, 'bebidas'],
  ['Agua Saborizada Levité 500ml', 20, 600, '', 1200, 'bebidas']
];
const wsBebidasDomo = XLSX.utils.aoa_to_sheet(bebidasDomoData);
XLSX.utils.book_append_sheet(workbook, wsBebidasDomo, 'BEBIDAS DOMO');

// Sheet 2: SNACKS DOMO
const snacksDomoData = [
  ['Producto', 'Stock', 'Costo', 'Notas', 'Precio', 'Categoria'],
  ['Papas Lays Clásicas 85g', 15, 700, '', 1400, 'snacks'],
  ['Doritos Queso 90g', 12, 850, '', 1600, 'snacks'],
  ['Turrón Arcor', 50, 150, '', 400, 'snacks'],
  ['Barra de Cereal Cerealmix', 30, 300, '', 600, 'snacks'],
  ['Maní Salado 100g', 20, 400, '', 900, 'snacks'],
  ['Alfajor Havanna 70%', 25, 800, '', 1600, 'snacks'],
  ['Chocolatina Cadbury', 18, 600, '', 1200, 'snacks']
];
const wsSnacksDomo = XLSX.utils.aoa_to_sheet(snacksDomoData);
XLSX.utils.book_append_sheet(workbook, wsSnacksDomo, 'SNACKS DOMO');

// Sheet 3: BEBIDAS SIGNO
const bebidasSignoData = [
  ['Producto', 'Stock', 'Costo', 'Notas', 'Precio', 'Categoria'],
  ['Coca Cola 500ml', 20, 800, '', 1500, 'bebidas'],
  ['Agua Mineral 500ml', 25, 500, '', 1000, 'bebidas'],
  ['Powerade 500ml', 10, 900, '', 1800, 'bebidas'],
  ['Cerveza Heineken 473ml', 15, 1200, '', 2500, 'bebidas']
];
const wsBebidasSigno = XLSX.utils.aoa_to_sheet(bebidasSignoData);
XLSX.utils.book_append_sheet(workbook, wsBebidasSigno, 'BEBIDAS SIGNO');

// Sheet 4: SNACKS SIGNO
const snacksSignoData = [
  ['Producto', 'Stock', 'Costo', 'Notas', 'Precio', 'Categoria'],
  ['Papas Lays Clásicas 85g', 10, 700, '', 1400, 'snacks'],
  ['Doritos Queso 90g', 8, 850, '', 1600, 'snacks'],
  ['Turrón Arcor', 30, 150, '', 400, 'snacks']
];
const wsSnacksSigno = XLSX.utils.aoa_to_sheet(snacksSignoData);
XLSX.utils.book_append_sheet(workbook, wsSnacksSigno, 'SNACKS SIGNO');

const outputPath = path.join(__dirname, '../public/plantilla_importacion_stock.xlsx');
XLSX.writeFile(workbook, outputPath);
console.log('Plantilla Excel generada en:', outputPath);
