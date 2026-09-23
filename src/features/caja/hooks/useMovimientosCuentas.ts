import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/features/auth';

export type OrigenMovimientoCuenta =
  | 'reserva_pago'
  | 'clase_cobro'
  | 'venta'
  | 'gasto'
  | 'otro_ingreso'
  | 'gasto_cuota'
  | 'caja_manual'
  | 'transferencia_origen'
  | 'transferencia_destino';

export interface MovimientoCuentaItem {
  id: string;
  club_id: number;
  cuenta_id: number;
  cuenta_nombre: string;
  tipo_cuenta: string;
  fecha_hora: string;
  origen: OrigenMovimientoCuenta;
  concepto: string;
  detalle: string | null;
  signo: 1 | -1;
  monto: number;
  usuario_id: string | null;
  usuario_nombre: string;
  usuario_rol: string | null;
}

export interface UseMovimientosCuentasArgs {
  desde?: string; // YYYY-MM-DD
  hasta?: string; // YYYY-MM-DD
  cuentaId?: number | null;
}

export const MOVIMIENTOS_CUENTAS_QUERY_KEY = ['movimientos_cuentas'] as const;

export function useMovimientosCuentas({
  desde,
  hasta,
  cuentaId,
}: UseMovimientosCuentasArgs): UseQueryResult<MovimientoCuentaItem[], Error> {
  const { club } = useSession();

  return useQuery<MovimientoCuentaItem[], Error>({
    queryKey: [...MOVIMIENTOS_CUENTAS_QUERY_KEY, club?.id, desde, hasta, cuentaId],
    queryFn: async () => {
      if (!club?.id) return [];

      const desdeIso = desde ? `${desde}T00:00:00.000-03:00` : null;
      const hastaIso = hasta ? `${hasta}T23:59:59.999-03:00` : null;

      const results: MovimientoCuentaItem[] = [];

      // A. Pagos de reservas
      let rpQuery = supabase
        .from('reserva_pagos')
        .select('id, club_id, cuenta_id, fecha_hora, tipo, medio_pago, monto, observaciones, usuario_id, cuentas(nombre, tipo), usuarios(nombre, rol)')
        .eq('club_id', club.id)
        .not('cuenta_id', 'is', null);
      if (cuentaId) rpQuery = rpQuery.eq('cuenta_id', cuentaId);
      if (desdeIso) rpQuery = rpQuery.gte('fecha_hora', desdeIso);
      if (hastaIso) rpQuery = rpQuery.lte('fecha_hora', hastaIso);

      // B. Ventas de buffet
      let vQuery = supabase
        .from('ventas')
        .select('id, club_id, cuenta_id, fecha_hora, monto_total, observaciones, usuario_id, cuentas(nombre, tipo), usuarios(nombre, rol)')
        .eq('club_id', club.id)
        .not('cuenta_id', 'is', null);
      if (cuentaId) vQuery = vQuery.eq('cuenta_id', cuentaId);
      if (desdeIso) vQuery = vQuery.gte('fecha_hora', desdeIso);
      if (hastaIso) vQuery = vQuery.lte('fecha_hora', hastaIso);

      // C. Cobros de clases
      let ccQuery = supabase
        .from('clase_cobros')
        .select('id, club_id, cuenta_id, fecha_hora, monto, observaciones, usuario_id, cuentas(nombre, tipo), usuarios(nombre, rol)')
        .eq('club_id', club.id)
        .not('cuenta_id', 'is', null);
      if (cuentaId) ccQuery = ccQuery.eq('cuenta_id', cuentaId);
      if (desdeIso) ccQuery = ccQuery.gte('fecha_hora', desdeIso);
      if (hastaIso) ccQuery = ccQuery.lte('fecha_hora', hastaIso);

      // D. Gastos directos pagados
      let gQuery = supabase
        .from('gastos')
        .select('id, club_id, cuenta_id, fecha_pago, fecha_gasto, fecha_alta, categoria_nombre, proveedor, monto, observaciones, usuario_id, cuentas(nombre, tipo), usuarios(nombre, rol)')
        .eq('club_id', club.id)
        .eq('activo', true)
        .not('cuenta_id', 'is', null);
      if (cuentaId) gQuery = gQuery.eq('cuenta_id', cuentaId);

      // E. Otros ingresos cobrados
      let oiQuery = supabase
        .from('otros_ingresos')
        .select('id, club_id, cuenta_id, fecha_cobro, fecha, fecha_alta, concepto, monto, observaciones, usuario_id, cuentas(nombre, tipo), usuarios(nombre, rol)')
        .eq('club_id', club.id)
        .eq('activo', true)
        .not('cuenta_id', 'is', null);
      if (cuentaId) oiQuery = oiQuery.eq('cuenta_id', cuentaId);

      // F. Cuotas de gastos pagadas
      let gcQuery = supabase
        .from('gasto_cuotas')
        .select('id, club_id, gasto_id, numero, fecha_pago, fecha_alta, monto, usuario_id, cuenta_id, cuentas(nombre, tipo), usuarios(nombre, rol)')
        .eq('club_id', club.id)
        .not('cuenta_id', 'is', null)
        .not('fecha_pago', 'is', null);
      if (cuentaId) gcQuery = gcQuery.eq('cuenta_id', cuentaId);

      // G. Transferencias internas
      let trQuery = supabase
        .from('transferencias')
        .select('id, club_id, cuenta_origen_id, cuenta_destino_id, fecha_hora, monto, concepto, observaciones, usuario_id, usuarios(nombre, rol)')
        .eq('club_id', club.id);
      if (desdeIso) trQuery = trQuery.gte('fecha_hora', desdeIso);
      if (hastaIso) trQuery = trQuery.lte('fecha_hora', hastaIso);

      // H. Movimientos manuales de caja
      let cmQuery = supabase
        .from('caja_movimientos_manuales')
        .select('id, club_id, fecha_hora, tipo, monto, concepto, observaciones, usuario_id, usuarios(nombre, rol)')
        .eq('club_id', club.id);
      if (desdeIso) cmQuery = cmQuery.gte('fecha_hora', desdeIso);
      if (hastaIso) cmQuery = cmQuery.lte('fecha_hora', hastaIso);

      // Ejecutar todas en paralelo
      const [rpRes, vRes, ccRes, gRes, oiRes, gcRes, trRes, cmRes] = await Promise.all([
        rpQuery,
        vQuery,
        ccQuery,
        gQuery,
        oiQuery,
        gcQuery,
        trQuery,
        cmQuery,
      ]);

      // 1. Procesar Pagos de Reservas
      if (rpRes.data) {
        for (const r of rpRes.data as any[]) {
          const c = r.cuentas;
          const u = r.usuarios;
          results.push({
            id: `reserva_pago_${r.id}`,
            club_id: r.club_id,
            cuenta_id: r.cuenta_id,
            cuenta_nombre: c?.nombre ?? `Cuenta #${r.cuenta_id}`,
            tipo_cuenta: c?.tipo ?? 'otro',
            fecha_hora: r.fecha_hora,
            origen: 'reserva_pago',
            concepto: r.tipo === 'reembolso' ? 'Reembolso Turno' : r.tipo === 'sena' ? 'Seña Turno' : 'Cobro Turno',
            detalle: r.observaciones ?? 'Pago de turno',
            signo: r.tipo === 'reembolso' ? -1 : 1,
            monto: Number(r.monto),
            usuario_id: r.usuario_id,
            usuario_nombre: u?.nombre ?? 'Sistema',
            usuario_rol: u?.rol ?? null,
          });
        }
      }

      // 2. Procesar Ventas Buffet
      if (vRes.data) {
        for (const v of vRes.data as any[]) {
          const c = v.cuentas;
          const u = v.usuarios;
          results.push({
            id: `venta_${v.id}`,
            club_id: v.club_id,
            cuenta_id: v.cuenta_id,
            cuenta_nombre: c?.nombre ?? `Cuenta #${v.cuenta_id}`,
            tipo_cuenta: c?.tipo ?? 'otro',
            fecha_hora: v.fecha_hora,
            origen: 'venta',
            concepto: 'Venta Buffet',
            detalle: v.observaciones ?? 'Venta en buffet',
            signo: 1,
            monto: Number(v.monto_total),
            usuario_id: v.usuario_id,
            usuario_nombre: u?.nombre ?? 'Sistema',
            usuario_rol: u?.rol ?? null,
          });
        }
      }

      // 3. Procesar Cobros Clases
      if (ccRes.data) {
        for (const cc of ccRes.data as any[]) {
          const c = cc.cuentas;
          const u = cc.usuarios;
          results.push({
            id: `clase_cobro_${cc.id}`,
            club_id: cc.club_id,
            cuenta_id: cc.cuenta_id,
            cuenta_nombre: c?.nombre ?? `Cuenta #${cc.cuenta_id}`,
            tipo_cuenta: c?.tipo ?? 'otro',
            fecha_hora: cc.fecha_hora,
            origen: 'clase_cobro',
            concepto: 'Cobro Clase',
            detalle: cc.observaciones ?? 'Clase de pádel',
            signo: 1,
            monto: Number(cc.monto),
            usuario_id: cc.usuario_id,
            usuario_nombre: u?.nombre ?? 'Sistema',
            usuario_rol: u?.rol ?? null,
          });
        }
      }

      // 4. Procesar Gastos Directos
      if (gRes.data) {
        for (const g of gRes.data as any[]) {
          const fecha = g.fecha_pago ? `${g.fecha_pago}T12:00:00.000-03:00` : (g.fecha_gasto ? `${g.fecha_gasto}T12:00:00.000-03:00` : g.fecha_alta);
          if (desdeIso && fecha < desdeIso) continue;
          if (hastaIso && fecha > hastaIso) continue;
          const c = g.cuentas;
          const u = g.usuarios;
          results.push({
            id: `gasto_${g.id}`,
            club_id: g.club_id,
            cuenta_id: g.cuenta_id,
            cuenta_nombre: c?.nombre ?? `Cuenta #${g.cuenta_id}`,
            tipo_cuenta: c?.tipo ?? 'otro',
            fecha_hora: fecha,
            origen: 'gasto',
            concepto: g.proveedor ? `${g.categoria_nombre ?? 'Gasto'} (${g.proveedor})` : (g.categoria_nombre ?? 'Gasto'),
            detalle: g.observaciones ?? g.proveedor ?? null,
            signo: -1,
            monto: Number(g.monto),
            usuario_id: g.usuario_id,
            usuario_nombre: u?.nombre ?? 'Sistema',
            usuario_rol: u?.rol ?? null,
          });
        }
      }

      // 5. Procesar Otros Ingresos
      if (oiRes.data) {
        for (const oi of oiRes.data as any[]) {
          const fecha = oi.fecha_cobro ? `${oi.fecha_cobro}T12:00:00.000-03:00` : (oi.fecha ? `${oi.fecha}T12:00:00.000-03:00` : oi.fecha_alta);
          if (desdeIso && fecha < desdeIso) continue;
          if (hastaIso && fecha > hastaIso) continue;
          const c = oi.cuentas;
          const u = oi.usuarios;
          results.push({
            id: `otro_ingreso_${oi.id}`,
            club_id: oi.club_id,
            cuenta_id: oi.cuenta_id,
            cuenta_nombre: c?.nombre ?? `Cuenta #${oi.cuenta_id}`,
            tipo_cuenta: c?.tipo ?? 'otro',
            fecha_hora: fecha,
            origen: 'otro_ingreso',
            concepto: oi.concepto ?? 'Otro Ingreso',
            detalle: oi.observaciones ?? null,
            signo: 1,
            monto: Number(oi.monto),
            usuario_id: oi.usuario_id,
            usuario_nombre: u?.nombre ?? 'Sistema',
            usuario_rol: u?.rol ?? null,
          });
        }
      }

      // 6. Procesar Cuotas de Gastos (CxP)
      if (gcRes.data) {
        for (const gc of gcRes.data as any[]) {
          const fecha = gc.fecha_pago ? `${gc.fecha_pago}T12:00:00.000-03:00` : gc.fecha_alta;
          if (desdeIso && fecha < desdeIso) continue;
          if (hastaIso && fecha > hastaIso) continue;
          const c = gc.cuentas;
          const u = gc.usuarios;
          results.push({
            id: `gasto_cuota_${gc.id}`,
            club_id: gc.club_id,
            cuenta_id: gc.cuenta_id,
            cuenta_nombre: c?.nombre ?? `Cuenta #${gc.cuenta_id}`,
            tipo_cuenta: c?.tipo ?? 'otro',
            fecha_hora: fecha,
            origen: 'gasto_cuota',
            concepto: `Pago Cuota #${gc.numero}`,
            detalle: `Gasto ref #${gc.gasto_id}`,
            signo: -1,
            monto: Number(gc.monto),
            usuario_id: gc.usuario_id,
            usuario_nombre: u?.nombre ?? 'Sistema',
            usuario_rol: u?.rol ?? null,
          });
        }
      }

      // Cuentas map para transferencias y caja manual
      let cuentasData: any[] = [];
      if (trRes.data?.length || cmRes.data?.length) {
        const { data } = await supabase.from('cuentas').select('id, nombre, tipo, es_caja_fisica').eq('club_id', club.id);
        cuentasData = data ?? [];
      }
      const cMap = new Map((cuentasData ?? []).map((c: any) => [c.id, c]));
      const cuentaEfectivo = cuentasData.find((c: any) => c.tipo === 'efectivo' || c.es_caja_fisica);

      // 7. Procesar Transferencias Internas
      if (trRes.data && trRes.data.length > 0) {
        for (const tr of trRes.data as any[]) {
          const u = tr.usuarios;
          const cOrig = cMap.get(tr.cuenta_origen_id);
          const cDest = cMap.get(tr.cuenta_destino_id);

          // Pata salida
          if (!cuentaId || cuentaId === tr.cuenta_origen_id) {
            results.push({
              id: `transferencia_salida_${tr.id}`,
              club_id: tr.club_id,
              cuenta_id: tr.cuenta_origen_id,
              cuenta_nombre: cOrig?.nombre ?? `Cuenta #${tr.cuenta_origen_id}`,
              tipo_cuenta: cOrig?.tipo ?? 'otro',
              fecha_hora: tr.fecha_hora,
              origen: 'transferencia_origen',
              concepto: 'Transferencia enviada',
              detalle: tr.concepto ?? (cDest ? `Hacia ${cDest.nombre}` : 'Transferencia'),
              signo: -1,
              monto: Number(tr.monto),
              usuario_id: tr.usuario_id,
              usuario_nombre: u?.nombre ?? 'Sistema',
              usuario_rol: u?.rol ?? null,
            });
          }

          // Pata entrada
          if (!cuentaId || cuentaId === tr.cuenta_destino_id) {
            results.push({
              id: `transferencia_entrada_${tr.id}`,
              club_id: tr.club_id,
              cuenta_id: tr.cuenta_destino_id,
              cuenta_nombre: cDest?.nombre ?? `Cuenta #${tr.cuenta_destino_id}`,
              tipo_cuenta: cDest?.tipo ?? 'otro',
              fecha_hora: tr.fecha_hora,
              origen: 'transferencia_destino',
              concepto: 'Transferencia recibida',
              detalle: tr.concepto ?? (cOrig ? `Desde ${cOrig.nombre}` : 'Transferencia'),
              signo: 1,
              monto: Number(tr.monto),
              usuario_id: tr.usuario_id,
              usuario_nombre: u?.nombre ?? 'Sistema',
              usuario_rol: u?.rol ?? null,
            });
          }
        }
      }

      // 8. Procesar Movimientos Manuales de Caja
      if (cmRes.data && cmRes.data.length > 0 && cuentaEfectivo) {
        if (!cuentaId || cuentaId === cuentaEfectivo.id) {
          for (const cm of cmRes.data as any[]) {
            const u = cm.usuarios;
            const esPositivo = cm.tipo === 'ajuste_positivo';
            results.push({
              id: `caja_manual_${cm.id}`,
              club_id: cm.club_id,
              cuenta_id: cuentaEfectivo.id,
              cuenta_nombre: cuentaEfectivo.nombre,
              tipo_cuenta: cuentaEfectivo.tipo,
              fecha_hora: cm.fecha_hora,
              origen: 'caja_manual',
              concepto: esPositivo ? 'Ingreso Manual Caja' : 'Egreso Manual Caja',
              detalle: cm.concepto ? `${cm.concepto}${cm.observaciones ? ' · ' + cm.observaciones : ''}` : (cm.observaciones ?? 'Movimiento manual'),
              signo: esPositivo ? 1 : -1,
              monto: Number(cm.monto),
              usuario_id: cm.usuario_id,
              usuario_nombre: u?.nombre ?? 'Sistema',
              usuario_rol: u?.rol ?? null,
            });
          }
        }
      }

      // Ordenar por fecha_hora descendente
      results.sort((a, b) => new Date(b.fecha_hora).getTime() - new Date(a.fecha_hora).getTime());

      return results;
    },
    enabled: Boolean(club?.id),
  });
}
