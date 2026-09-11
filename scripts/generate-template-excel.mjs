import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const workbook = XLSX.utils.book_new();

// Encabezados de la plantilla vacía
const headers = ['Producto', 'Stock', 'Costo', 'Precio', 'Categoria'];
const ws = XLSX.utils.aoa_to_sheet([headers]);

// Anchos de columna recomendados
ws['!cols'] = [
  { wch: 35 }, // Producto
  { wch: 10 }, // Stock
  { wch: 12 }, // Costo
  { wch: 12 }, // Precio
  { wch: 15 }, // Categoria
];

XLSX.utils.book_append_sheet(workbook, ws, 'Productos');

const outputPath = path.join(__dirname, '../public/plantilla_importacion_stock.xlsx');
XLSX.writeFile(workbook, outputPath);
console.log('Plantilla Excel vacía generada en:', outputPath);
