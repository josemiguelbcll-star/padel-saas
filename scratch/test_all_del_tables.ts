import { createClient } from '@supabase/supabase-js';

const url = 'https://bpvpxjwripilymetfujz.supabase.co';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdnB4andyaXBpbHltZXRmdWp6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTI1NjgyMiwiZXhwIjoyMDk0ODMyODIyfQ.YmK7AuS5rF2iFx1b6xA1Mutxir8ATeWACV6962IRYGs';
const supabase = createClient(url, serviceKey);

const allTablesInDelete = [
  'reserva_consumos',
  'reserva_cobros',
  'reserva_pagos',
  'reservas_jugadores',
  'reservas',
  'venta_items',
  'ventas',
  'movimientos_stock',
  'compra_items',
  'compras',
  'cuotas_gasto',
  'gasto_cuotas',
  'gastos',
  'gastos_recurrentes',
  'otros_ingresos',
  'turnos_fijos_bloqueos',
  'turnos_fijos',
  'clase_alumnos',
  'clase_cobros',
  'clases',
  'profesores',
  'movimientos_caja',
  'turnos_caja',
  'transferencias',
  'movimientos_cuenta',
  'medio_cuenta_default',
  'cuentas',
  'unidades_negocio',
  'categorias_gasto',
  'productos',
  'proveedores',
  'tarifas',
  'canchas',
  'franjas_turno',
  'anulaciones',
  'club_fotos',
  'noticias_feed',
  'club_posts',
  'promociones',
  'desafios',
  'jugador_app_club_link',
  'club_mercadopago_config',
  'club_perfil_publico',
  'usuarios',
  'clubes'
];

async function checkReal() {
  const missing: string[] = [];
  const valid: string[] = [];

  for (const t of allTablesInDelete) {
    const { error } = await supabase.from(t).select('id').limit(1);
    if (error && (error.code === 'PGRST205' || error.message.includes('Could not find'))) {
      missing.push(t);
    } else {
      valid.push(t);
    }
  }

  console.log('TABLAS QUE SI EXISTEN:', valid);
  console.log('TABLAS QUE NO EXISTEN:', missing);
}

checkReal().catch(console.error);
