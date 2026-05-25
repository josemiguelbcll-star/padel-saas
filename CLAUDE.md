# Proyecto: SaaS de gestión para clubes de pádel

## Documento maestro
Este proyecto se construye siguiendo el Documento Técnico Maestro v1.0
ubicado en docs/Documento_Tecnico_Maestro.docx. TODA decisión técnica
debe estar alineada con ese documento. Si algo no está cubierto ahí,
preguntar antes de inventar.

## Atributos de calidad (norte del proyecto)
1. Disponibilidad (uptime 99.5% mínimo)
2. Integridad de datos (transacciones atómicas)
3. Seguridad multi-tenant (RLS estricta)
4. Performance operativa (grilla <1s, POS <200ms)
5. Confiabilidad y recuperación (Sentry, backups)
6. Mantenibilidad

## Stack técnico
- Frontend: Vite + React 18 + TypeScript estricto
- UI: Tailwind CSS + shadcn/ui
- Data: @supabase/supabase-js + @tanstack/react-query
- Router: react-router-dom v6
- Validación: zod
- Errores: @sentry/react
- Backend: Supabase (Postgres + Auth + RLS + Edge Functions)
- Testing: **NO hay infraestructura todavía** (sin vitest/jest, sin
  script `test`, cero tests propios). Montarla es un pendiente (ver
  blindaje del EERR). Cuando se monte: vitest (las funciones puras
  corren en Node plano, sin tocar Supabase ni React).

## Reglas no negociables
1. RLS habilitada en TODAS las tablas, sin excepción.
2. Toda tabla de negocio tiene club_id BIGINT NOT NULL.
3. Toda política de INSERT/UPDATE lleva WITH CHECK.
4. NUNCA usar service_role_key en el frontend.
5. NUNCA usar 'any' en TypeScript sin justificación.
6. Operaciones multi-tabla van en funciones RPC, no en frontend.
7. Tokens visuales como CSS custom properties, NO hardcodeados.
8. Estructura por feature, NO por tipo de archivo.
9. Las migraciones SQL no se modifican una vez ejecutadas.

## Flujo de trabajo
1. ANTES de generar código, mostrar el plan: qué archivos vas a crear.
2. NO instalar dependencias nuevas sin avisar.
3. NO crear migraciones SQL sin avisar.
4. NO modificar políticas RLS existentes sin avisar.
5. Si una tarea es ambigua, preguntar antes de asumir.

---

# ⭐ REGLA DE ORO — ATRIBUCIÓN POR UNIDAD DE NEGOCIO DEL EERR (INVIOLABLE)

**Cada ingreso y cada costo del Estado de Resultados va a SU unidad de
negocio. Esto NO se puede romper.** Es el principio que sostiene toda la
rentabilidad por unidad; si se viola, los márgenes mienten.

### El mapeo (modelo actual)
- **Alquiler de la cancha → Canchas.** Canchas usa SOLO `monto_alquiler`
  del pago. **El consumo del turno NUNCA va a Canchas.**
- **Consumo de buffet del turno → Buffet.**
- **Consumo de shop del turno → Shop.**
- **Venta de mostrador (POS) → su línea** (buffet o shop, según el
  snapshot `venta_items.linea`).
- **Clase → Clases.** (Ver deuda "Replanteo Clases": el negocio puede
  querer remapear esto a Canchas — cuando se ejecute, se cambia EN la
  función centralizada de atribución, no esparcido.)
- **El COSTO (CMV) de cada venta va a la MISMA unidad que su ingreso.**
  Ingreso y costo de una línea salen de las mismas filas → margen real
  por unidad, no inflado.

### Cómo se reconoce el ingreso del consumo del turno
- Base **DEVENGADA por línea**: monto y costo salen de `reserva_consumos`
  (subtotal + costo_unitario×cantidad), separados por `linea`.
- Se **gatilla al COBRAR el turno** (el pago tiene `monto_consumo>0`).
- **Sin doble conteo**: se agrupa por `reserva_id` (NO por pago), así un
  turno con varios pagos cuenta su consumo una sola vez. Un turno cuenta
  en UN único mes (el primero en que se cobró su consumo).

### POR QUÉ es regla de oro (se violó una vez)
Esta separación se rompió en una modificación del EERR: Canchas pasó a
sumar el total del pago (alquiler + consumo), y el consumo del turno
apareció duplicado/mal atribuido. **Se rompió porque la regla NO estaba
documentada ni blindada** — la lógica de atribución estaba (y sigue, hoy)
desparramada e inline dentro de `useResumenFinanciero`, con el branch
buffet/shop escrito DOS veces. Nada impedía mandar el consumo a Canchas.

### PENDIENTE — Blindaje (refactor A+B + tests, sesión dedicada)
Documentado ahora; el refactor queda para sesión propia.
- **(A) Función pura `atribuirIngresoAUnidad(fuente)`** centralizada en
  `src/features/finanzas/utils/`: recibe la FUENTE (alquiler / consumo+linea
  / venta_item+linea / clase) y devuelve la unidad. El costo se enruta por
  la MISMA clave → ingreso y costo no pueden divergir por construcción.
  Un único lugar que cambiar, documentable, y la duplicación buffet/shop
  colapsa a una llamada.
- **(B) Extraer el cómputo a `computeResumenFinanciero(filas)`** puro,
  dejando el `queryFn` solo con los `await` (I/O). Esto hace TESTEABLE la
  regla sin mockear Supabase: el test arma filas plain (turno con alquiler
  + consumo buffet + consumo shop, cobrado) y verifica la atribución.
- **Suite vitest** que falle en rojo si alguien manda el consumo a Canchas
  o desalinea costo/ingreso (escenarios: turno cobrado con 3 líneas; turno
  no cobrado no cuenta consumo; reembolso resta alquiler; venta mostrador
  por línea; clase→Clases; costo→misma unidad que su ingreso).
- Hoy `useResumenFinanciero` NO es testeable: la lógica vive en un closure
  que llama a `supabase.from(...)` con ~8 queries encadenadas.

---

# Principios financieros (cómo piensa el EERR)

Estos principios rigen todo el módulo financiero. El dueño es experto en
finanzas; el modelo debe respetarlos.

- **Devengado vs percibido.** El gasto se **devenga en su mes**
  (`fecha_gasto`), independientemente de cuándo se paga. El PAGO es un
  evento aparte (caja / cuotas). **Pagar una Cuenta por Pagar NO re-impacta
  el EERR** — el resultado ya tomó el gasto cuando se devengó; el pago solo
  mueve caja.
- **IVA es flujo, no resultado.** Los márgenes se calculan sobre **neto**.
  El IVA es un pasaje de dinero (se cobra/paga por cuenta del fisco), no
  ganancia ni pérdida del período.
- **CMV = costo de lo VENDIDO, no de lo comprado.** El costo de mercadería
  entra al EERR cuando se VENDE (vía `venta_items.costo_unitario` snapshot ×
  cantidad). La COMPRA de mercadería es flujo de caja / movimiento de
  inventario, NO gasto del período. Por eso los gastos con categoría
  `es_mercaderia=TRUE` se EXCLUYEN del EERR (evita doble conteo: se restaría
  al comprar y al vender).
- **Activo fijo = CAPEX al balance, no gasto.** Una inversión en activo
  (ej. una cancha nueva) no es gasto del período; va al balance y se
  deprecia. No se carga como gasto operativo.
- **Condición fiscal por club** (monotributo vs Responsable Inscripto):
  el club RI computa el gasto a NETO (descuenta IVA); el monotributista a
  TOTAL (el IVA es costo, no lo recupera). `fn_recibir_oc` y el registro de
  gasto respetan la condición fiscal del club (0043).

---

# Estado construido (módulos y migraciones)

## Fundaciones (0001–0028, resumen)
Schema inicial + RLS multi-tenant (helpers `current_club_id()`,
`current_user_rol()`, `current_club_caja_abierta()`), canchas y tarifas,
reservas + jugadores + franjas, clases y profesores, cobros de reserva y
de clase, Buffet Capa 1 (productos, stock por movimientos, ventas POS),
costo de producto (margen), fichas de jugadores, **consumos del turno**
(`reserva_consumos`, fn_cargar/quitar consumo), pagos por persona, tipo de
reparto del consumo (general/partido), marca y logo del club, módulo de
usuarios, plataforma (planes/módulos), **Caja** (turnos_caja, movimientos,
integración de cobros), líneas Buffet/Shop (`venta_items.linea`,
`reserva_consumos.linea`), modelo financiero base (unidades de negocio,
categorías de gasto, otros_ingresos), RPCs financieras + integración caja.

## Reservas, grilla y turno como cuenta
- **Consumos del turno**: `reserva_consumos` (1 fila = 1 carga, snapshots
  de nombre/precio/costo/subtotal, `tipo_reparto` general|partido, `linea`
  buffet|shop). UI consolida por (producto, tipo_reparto). El movimiento de
  stock se ata al consumo (`fuente='consumo_turno'`).
- **Pagos del turno**: `reserva_pagos` con desglose `monto_alquiler` +
  `monto_consumo` (preparado para la cuenta tipo mesa de restaurante y la
  división informativa entre jugadores).

## Turnos fijos (0029–0033)
- **0029 — Tarifas con vigencia temporal.** `lineage_id` agrupa versiones
  de la misma franja a lo largo del tiempo; `vigente_desde`/`vigente_hasta`;
  EXCLUDE server-side garantiza no-solapamiento por linaje. Soporta
  **aumentos programados a futuro** (cierra versión vigente + crea nueva,
  atómico). `fn_resolver_tarifa(fecha, hora)` resuelve el precio vigente A
  LA FECHA del slot — base de todo el modelo. Frontend por linaje (precio
  vigente + aviso de aumentos, "Cambiar precio" con fecha, historial).
- **0030 — Turnos fijos.** `turnos_fijos` + `reservas.turno_fijo_id`
  (FK ON DELETE SET NULL) + 4 RPCs (crear/actualizar/cancelar/materializar).
  La materialización RESUELVE TARIFA POR FECHA, es idempotente (CHECK +
  UNIQUE parcial), no pisa reservas sueltas (captura `exclusion_violation`),
  saltea clases. Devuelve 5 contadores. Frontend `/turnos-fijos` con
  "Guardar y seguir agregando".
- **0031 — Bloqueo de slot en `fn_crear_reserva`.** Una reserva suelta no
  puede pisar el slot de un turno fijo activo vigente. Solo afecta sueltas
  (la materialización hace INSERT directo).
- **0032 — `fn_eliminar_turno_fijo`.** Cancela pendientes futuras, preserva
  cobradas/jugadas (sin link por ON DELETE SET NULL), libera el slot.
  Distinto de "desactivar". Gate admin.
- **0033 — FIX policy DELETE faltante.** La 0030 no creó policy DELETE → el
  DELETE de `fn_eliminar_turno_fijo` (INVOKER) se filtraba por RLS sin error.
  Agregada `turnos_fijos_delete_admin` + GRANT DELETE. Decisión: INVOKER +
  policy específica (defensa en capas) en vez de DEFINER.
- **Frontend Bloque 2**: eliminar desde "Más acciones", materialización
  configurable (4/8/12/16 semanas, default 12).
- **Proyección financiera** (construido — verificar alcance): los archivos
  `calcularProyeccionTurnosFijos.ts` / `calcularProyeccionClases.ts` /
  `useProyeccionAlquileres.ts` existen (ocurrencias del mes × tarifa vigente
  a la fecha de cada ocurrencia), pero puede estar a medias. Confirmar qué
  quedó efectivamente terminado antes de apoyarse en ello.

## Tarifas: vigencia temporal + 2D (0029, 0034–0035, 0051–0052)
- **0034–0035 — Tarifas de clases.** Mismo modelo de tarifas para el
  alquiler de cancha de clases; cobro de clase vía `fn_resolver_tarifa`.
- **0051 — TARIFA 2D (franja × duración).** Columna `tarifas.duracion_min`
  (NULL = aplica a cualquier duración; valor específico = solo esa). En la
  resolución, **la específica gana sobre NULL**. `fn_resolver_tarifa` toma
  `p_duracion`; el ABM (crear/cambiar precio/metadata) propaga `duracion_min`;
  la materialización de turnos fijos pasa la duración del turno.
  POR QUÉ: con franjas de duración configurable, un mismo horario puede
  tener precio distinto según dure 60 o 90 min.
- **0052 — FIX bug lineage temporal.** `fn_crear_tarifa` /
  `fn_crear_tarifa_clase` usaban `lineage_id=1` temporal, que colisiona con
  el linaje real 1 en el EXCLUDE al crear varias tarifas seguidas. Fix:
  `nextval('..._id_seq')`. Bug PREEXISTENTE (0029/0034), no introducido por
  la 2D.

## Franjas de turno / grilla dinámica (0050)
- **0050 — `franjas_turno`.** Motor GENÉRICO de duración de turno
  configurable por club (nada hardcodeado, misma filosofía que tarifas).
  Tabla con `duraciones_min INTEGER[]` (una franja puede permitir varias
  duraciones) + `cancha_id` nullable (regla global o por cancha).
  `fn_resolver_duraciones` devuelve las duraciones permitidas para un slot.
  Reemplaza el viejo `duracion_turno_default` (queda de fallback).
- **Frontend grilla dinámica**: `calcularDisponibles` tilea por franja y
  soporta **inicios flexibles**; selector de duración al reservar
  (`NuevaReservaDialog`). **FIX del bug de layout**: todos los bloques
  (reserva/clase/disponible) posicionan por el MISMO sistema —
  minutos desde apertura × altura de slot — eliminando los solapamientos.
  → Cierra las tres viejas viñetas pendientes de Sprint 3 (duración por
  franja, inicios flexibles, bug de layout).

## Consumos del turno + debounce anti-doble-submit (0013–0026, 0053)
- **0026 — `fn_cargar_consumo_turno` acepta shop.** El turno absorbe
  cualquier producto activo (un jugador puede cargar pelotas y pagarlas al
  final). Mantiene el snapshot de `linea` para el EERR.
- **0053 — DEBOUNCE server-side.** Un doble-tap / ghost-click táctil se
  colaba por la ventana de carrera del guard `disabled={isPending}` del
  frontend (que tarda un render de React) → cargas DUPLICADAS de consumos
  (filas idénticas con <1s de diferencia), que además duplicaban el descuento
  de stock y, vía la regla de oro, inflaban el Buffet al doble. Fix:
  - **Backend**: tras el `SELECT ... FROM productos ... FOR UPDATE` (que ya
    existía y SERIALIZA la ráfaga del mismo producto), antes de validar
    stock e insertar, un `EXISTS` de consumo idéntico (club + reserva +
    producto + cantidad + tipo_reparto + usuario) en los últimos **2
    segundos**. Si existe → **no-op idempotente**: NO inserta consumo NI
    movimiento de stock (crítico: no duplica el descuento) y devuelve la
    fila existente. Race-safe gracias al FOR UPDATE (sin TOCTOU). Los 2s
    son constante técnica anti-ráfaga (no config de club): cubren el
    doble-tap accidental (<1s) sin bloquear un 2º consumo deliberado (>1,5–2s).
  - **Frontend**: `isSubmittingRef` síncrono en `ConsumosTurnoSection` (set
    true al tope del handler ANTES del await, chequeo al entrar, reset en
    finally) — cierra la ventana de carrera; `disabled={isPending}` queda
    como señal visual. Defensa en capas: ref (1ª capa) + RPC (autoritativa).

## Finanzas: EERR, caja, gastos, compras, CxP, recurrentes, anulación
- **0036 — Capas del EERR corporativo.** `unidad_tipo='financiero'` separa
  "Resultados financieros" (comisiones banco/MP, intereses) de otros gastos.
  Capas: margen bruto (ingresos − CMV − gastos directos a unidades) →
  resultado operativo (≈EBITDA, − estructura) → resultado neto (− financieros
  − otros).
- **0037 — `fn_ajustar_stock`.** Ajuste manual de stock auditable (movimiento,
  no edición destructiva).
- **0038–0044 — Compras y proveedores.** Proveedores, compras unificadas,
  detalle de bultos (`unidades_por_bulto`/`costo_por_bulto` con conversión),
  orden de compra en dos momentos (emitir / recibir), condición fiscal del
  club (RI=neto, monotributo=total), columnas de condición fiscal ampliadas.
- **0045 — Cuentas por Pagar (`gasto_cuotas`).** Plan de cuotas de un gasto.
  `fn_recibir_oc` con anticipo + cuotas; `fn_pagar_cuota`; `fn_registrar_gasto`
  genera cuota si queda pendiente. POR QUÉ: comprar a crédito sin perder el
  devengado (el gasto impacta el EERR en su mes; las cuotas son flujo).
- **0046 — Gastos recurrentes (plantillas).** `gastos_recurrentes` (plantilla)
  + `gastos.gasto_recurrente_id`; `fn_registrar_gasto` v4 vincula a plantilla.
- **0047 — FIX cierre de caja con cuotas en efectivo.** `fn_cerrar_caja` no
  restaba las `gasto_cuotas` pagadas en efectivo → falso faltante. Agregado
  el branch que las descuenta del esperado.
- **0048 — Sistema de ANULACIÓN (Filosofía B).** **No se reescribe el
  pasado**: nada se borra ni se edita; se marca `activo=FALSE` (soft-delete)
  y se asienta en el ledger `anulaciones` (FKs tipadas `gasto_id` /
  `gasto_cuota_id` + CHECK exactly-one, `motivo_tipo` enum + `motivo_detalle`,
  snapshot del estado anulado).
  - `fn_anular_gasto`: gate admin; guardas (no anular si tiene cuotas pagadas
    o si vino de una OC).
  - `fn_anular_pago_cuota`: **anular un pago revierte CAJA, no el EERR**
    (el gasto ya se devengó). Matriz por caja: si el pago fue en efectivo y
    la caja está cerrada → genera `ajuste_positivo`; si la caja sigue abierta
    → revierte el movimiento; otros medios → sin movimiento de caja.
  - `fn_pagar_cuota` con guarda: rechaza si el gasto está `activo=FALSE`.
- **0049 — Gasto recurrente uno-por-mes.** `fn_registrar_gasto` v5 + índice
  único parcial: una plantilla recurrente no puede cargarse dos veces en el
  mismo mes (evita el duplicado del alquiler del local, etc.).
- **EERR**: `useResumenFinanciero` (cómputo client-side desde varias queries).
  Aplica la REGLA DE ORO de atribución por unidad (ver sección destacada).

---

# Visión de producto

## El turno como cuenta (tipo mesa de restaurante)
Cada turno funciona como la mesa de un restaurante: una cuenta abierta que
acumula el alquiler + los consumos (buffet/shop), con múltiples medios de
pago y **división informativa** entre jugadores. Construido el núcleo
(`reserva_consumos`, `reserva_pagos` con desglose alquiler/consumo,
tipo_reparto). Falta integrar plenamente Caja (medios múltiples) y la
división UI.

### División de la cuenta del turno (Forma B, confirmada)
- Cantidad de jugadores CONFIGURABLE por turno (no fijo en 4). Parte justa =
  `monto_total_alquiler / cantidad_jugadores`. A cada uno se le descuenta lo
  que YA pagó (la seña se descuenta solo de quien la pagó). NO se reparte el
  saldo entre los que no pagaron.
- Acompañantes que solo consumen: se indica la CANTIDAD (un número), sin
  fichas. No pagan alquiler.
- El cobro es **informativo** ("a cada uno le toca $X"), no exige pago por
  persona. Modelo preparado (`reserva_jugadores`, `reserva_pagos.jugador_id`
  nullable).
- REQUISITO a sumar: indicar la cantidad de jugadores del partido.

## Buffet (a futuro)
- **Reposición de stock por facturas vía bot de WhatsApp**: subir facturas
  de compra, parsearlas y reponer stock. REQUISITO DE DISEÑO ya respetado:
  el stock se modela por movimientos auditables, las entradas pueden venir
  de una fuente externa sin migración destructiva.
- **Contabilidad / comprobantes fiscales**: las ventas hoy son registro
  interno. REQUISITO DE DISEÑO: dejar el registro listo para numeración de
  comprobantes y datos fiscales sin rehacer el modelo.

## Rentabilidad y EERR por unidad de negocio
- **Unidades**: Canchas (alquileres), Clases, Buffet, Shop, + estructura /
  financiero / otros (transversales). La atribución por unidad es la REGLA
  DE ORO (ver sección destacada).
- **Estructura del EERR**: ingresos por unidad − CMV (costo de lo vendido,
  buffet/shop) − gastos directos por unidad = margen; − estructura = operativo;
  − financieros − otros = resultado neto.
- **Costo de productos**: manual + último costo conocido (snapshot por venta),
  no promedio ponderado por ahora.
- **Orden de construcción** (definido): 1) costo en productos ✓, 2) gastos ✓,
  3) caja ✓, 4) EERR por unidad (frontend básico hecho; rediseño pendiente).

---

# Deudas funcionales prioritarias

**🔴 Cancelar aumento programado de tarifa.** La 0029 permite cargar aumentos
a futuro; si un admin lo carga por error, hoy solo se revierte por SQL manual.
Construir `fn_cancelar_aumento_programado` + botón "Cancelar este aumento".

**🟠 Replanteo: Clases como alquiler de cancha.** Confirmado: el profesor
cobra a los alumnos directo; el club solo cobra el **alquiler de la cancha**.
El modelo actual (`clases.precio` fijo, ingreso a unidad "Clases") está
desalineado. Plan: renombrar UI "Precio"→"Alquiler de cancha por clase";
**mapear `clase_cobros` a la unidad Canchas** (este es el cambio que tocará
la REGLA DE ORO — hacerlo EN la función centralizada de atribución); evaluar
resolver vía `fn_resolver_tarifa` en vez de `clases.precio`. Una clase ES
conceptualmente un turno fijo del profesor, pero NO se fusionan entidades.

**🟠 Planificación de profesores.** Cargar todas las clases de los profes de
una vez (como turnos fijos pero de clases) para ocupación y proyección. UX
tipo "Guardar y seguir agregando". Va con el replanteo de Clases.

**🟠 Simulador de alza de ingresos.** "Si subo X% las tarifas, cuánto más
facturo" sumando turnos fijos + alquiler de clases con tarifa hipotética.
Reusa el cálculo de proyección con un factor de ajuste. No modifica datos.

**🟠 Anular / corregir una venta de mostrador desde la UI** (admin). Hoy la
venta POS es inmutable desde la app. Falta anular una venta revirtiendo
atómicamente los movimientos de stock (compensatorios, fuente
`'anulacion_venta'`, NO borrado). La infraestructura de anulación Filosofía B
(`anulaciones`, 0048) ya existe para gastos y es el patrón a extender a ventas.

**🟠 Rediseño módulo financiero** (visión "Club Operating System"):
- Centros de ingreso vs estructura: que las unidades `estructura` NO aparezcan
  al cargar INGRESOS (solo gastos). Hoy el form las mezcla.
- Gastos esperados con alarmas (avisar si falta cargar un gasto habitual del
  mes). Se apoya en `gastos_recurrentes` (0046) + recordatorio.
- EERR con presentación de capas correctas (el cálculo ya está; falta UX).
- Rediseño visual del hub `/finanzas` con mirada de experto financiero.

# Deudas técnicas

- **Blindaje de la REGLA DE ORO del EERR** (refactor A+B + vitest): ver la
  sección destacada. Es la deuda técnica más importante hoy.
- **Trigger BEFORE INSERT en `reservas`** como defensa última del bloqueo de
  slot de turno fijo (hoy solo en `fn_crear_reserva`; un INSERT directo lo
  evadiría). Distinguir `turno_fijo_id IS NULL` (suelta, valida) vs NOT NULL
  (materialización, no toca).
- **Vigencia temporal (lineage + EXCLUDE) para `clases.precio` y futuras
  `membresias`.** Hoy solo `tarifas` (turnos y clases) la tiene. Al replantear
  Clases, evaluar moverlas a `fn_resolver_tarifa`. Membresías nace versionada.
- **Limpiar data de prueba** que quedó de ensayos en la app durante el
  desarrollo (reservas/turnos/cobros de prueba, y `reserva_consumos`
  duplicados de las ráfagas de prueba). Los duplicados de `reserva_consumos`
  son DATA DE PRUEBA (confirmado por el dueño: no son ventas reales) → se van
  con esta limpieza general, NO requieren reversión quirúrgica de stock. El
  debounce de la 0053 ya frena la generación de nuevos duplicados de acá en
  adelante (eso sí es permanente). Identificar prueba vs real (consultar al
  dueño si hay duda).

# Deudas de seguridad detectadas

**GRANTs de escritura a `authenticated` por DEFAULT** sobre tablas nuevas del
schema public. La barrera efectiva siempre fue la RLS (real y suficiente).
Para defensa en capas, auditar todas las tablas y REVOKE lo que no corresponda.
Hecho explícito en 0019 (modulos/planes/plan_modulos/plataforma_admins), 0029
(DELETE en tarifas), 0033 (GRANT DELETE admin-only en turnos_fijos). Resto
pendiente.
