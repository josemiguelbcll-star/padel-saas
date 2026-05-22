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

## Requisitos pendientes para Sprint 3 (Reservas)

- **DURACIÓN DE TURNO POR FRANJA, CONFIGURABLE POR CADA CLUB**: cada club
  debe poder configurar manualmente, según sus necesidades, que distintas
  franjas horarias tengan turnos de duración distinta. Caso real: turnos
  de 60 min por la mañana (clases) y de 90 min el resto del día (partidos).
  Filosofía: igual que tarifas, lo define cada club (desde un caso simple
  de duración única hasta franjas múltiples), nada hardcodeado. NO es un
  único `duracion_turno_default`; es una regla por franja, estructuralmente
  similar al modelo de tarifas (franja horaria → valor asociado). Diseñar
  e implementar en Sprint 3 junto con la grilla de Reservas, definiendo el
  modelo de datos (probablemente una tabla de franjas de duración). El
  `duracion_turno_default` actual queda como fallback cuando el club no
  configuró franjas.

- **FLEXIBILIDAD DE HORARIO DE INICIO DE TURNOS**: por ahora los turnos
  son encadenados (arrancan 8:00, 9:30, 11:00... en bloques de 90 fijos
  desde la apertura). A futuro, el club podría querer permitir que el
  cliente elija cualquier hora de inicio (cada 30 min), no solo los
  bloques encadenados. Pendiente de definir e implementar; afecta el
  algoritmo de generación de bloques "Disponible" en la grilla.

- **BUG DE LAYOUT EN LA GRILLA** (pendiente de arreglar, alto impacto):
  tras el rediseño visual, algunos bloques de reserva se solapan entre
  sí o con los "Disponible", y los "Disponible" no calzan exactamente
  con los huecos libres. Causa probable: desfase del cálculo de posición
  vertical tras bajar la altura de slot de 40 a 36px, o
  reservas/clases/disponibles usando bases de cálculo distintas.
  Pendiente: que todos los bloques usen el mismo sistema de posición
  (minutos desde apertura × altura de slot). **Diagnosticar y resolver
  ANTES de tocar la grilla en el Bloque 3 de Turnos Fijos** — sin esto
  arreglado, agregar bloques nuevos (badge fijo, slot comprometido)
  amplifica el problema.

## Estado del módulo Turnos Fijos

### Hecho y probado (migraciones aplicadas y commiteadas)

**0029 — Tarifas con vigencia temporal.** Refactor para versionado de
precios: `lineage_id` agrupa versiones de la misma franja a lo largo
del tiempo, `vigente_desde` / `vigente_hasta` definen el rango, EXCLUDE
constraint server-side garantiza no-solapamiento por linaje. Soporta
**aumentos programados con fecha futura** (cierra versión vigente +
crea nueva atómicamente). `fn_resolver_tarifa(fecha, hora)` (SECURITY
INVOKER) resuelve el precio vigente A LA FECHA del slot — la base de
todo el modelo. Frontend de tarifas rediseñado: vista por linaje con
precio vigente + aviso de aumentos programados, "Cambiar precio" con
fecha, drawer de historial, editar metadata afecta todas las versiones
del linaje.

**0030 — Turnos fijos.** Tabla `turnos_fijos` (titular jugador o nombre
libre, día de semana, hora, duración, vigencia, activo) + columna
`reservas.turno_fijo_id` (FK ON DELETE SET NULL) + 4 RPCs:
`fn_crear_turno_fijo`, `fn_actualizar_turno_fijo`, `fn_cancelar_turno_fijo`,
`fn_materializar_turnos_fijos`. La materialización RESUELVE TARIFA POR
FECHA de cada reserva (respeta aumentos programados de la 0029), es
**idempotente** (CHECK A en código + UNIQUE parcial en DB), captura
choques con reservas sueltas vía `EXCEPTION WHEN exclusion_violation`
sin pisarlas, saltea solapes con clases. Devuelve **5 contadores**:
`reservas_creadas`, `slots_ocupados_por_reserva_suelta`,
`slots_ocupados_por_clase`, `slots_sin_tarifa`, `slots_ya_materializados`.
Validación al crear turno fijo: **rechaza si no hay tarifa configurada
para ese slot**. Frontend Parte 1: pantalla `/turnos-fijos`, sidebar
acordeón Reservas, dialog de alta con botón **"Guardar y seguir
agregando"** (conserva cancha+día+duración+fechas, resetea cliente+hora),
modal de resultado con los 5 contadores.

**0031 — Bloqueo de slot en `fn_crear_reserva`.** Una reserva suelta
NO puede pisar el slot de un turno fijo activo vigente. Cambio
quirúrgico: solo +1 variable y +1 bloque de validación, resto idéntico
a la 0005. Aplica SOLO a reservas sueltas — la materialización hace
INSERT directo a la tabla y NO pasa por la RPC, por lo que no se ve
afectada. Mensaje accionable con nombre del titular.

**0032 — `fn_eliminar_turno_fijo`.** Cancela reservas pendientes
FUTURAS asociadas, preserva las cobradas/jugadas (quedan sin link
gracias al ON DELETE SET NULL de la 0030 pero NO se borran), borra el
turno fijo y libera el slot del UNIQUE parcial. Atómica, gate admin.
Distinto de "desactivar" (que solo hace `activo=FALSE`).

**0033 — FIX policy DELETE faltante.** La 0030 definió policies para
SELECT/INSERT/UPDATE pero NO para DELETE. Como `fn_eliminar_turno_fijo`
es SECURITY INVOKER, el DELETE se filtraba silenciosamente por RLS
(0 filas, sin error) y el turno fijo NO se borraba. Agregada policy
`turnos_fijos_delete_admin` (solo admin del club) + GRANT DELETE
explícito. Decisión: INVOKER + policy específica (defensa en capas)
en lugar de DEFINER (coherencia con el patrón del proyecto + policy
auditable en `pg_policies`).

**Frontend Bloque 2.** Eliminar turno fijo desde dropdown "Más
acciones" (`MoreVertical`) — separado de Editar/Desactivar para evitar
clicks accidentales, estilo destructive. Dialog con advertencias claras
(irreversible + cancela pendientes futuras + preserva cobradas + libera
el slot). Materialización **configurable** con selector de semanas
4/8/12/16 (default 12) reemplazando el botón fijo anterior.

### Pendientes del módulo

**Parte 3 — Proyección financiera (NO toca grilla, bajo riesgo).**
Hook `useProyeccionTurnosFijos(anio, mes)` en `src/features/finanzas/hooks/`
que calcula, para cada turno fijo activo, las ocurrencias del mes ×
tarifa vigente a la fecha de cada ocurrencia (reusa `resolverTarifa.ts`
client-side) = ingreso mensual proyectado. KPI en `/turnos-fijos`
(reemplaza el contador simple por la proyección $) + sección "Ingresos
recurrentes proyectados" en `/finanzas` (separada del Resultado del
Período, mira hacia adelante, NO se mezcla con lo cobrado). Devuelve
estructura `{ turnos: [...], total_mensual, cantidad_turnos_activos,
turnos_sin_tarifa }` para alertar si algún slot quedó sin tarifa.

**Bloque 3 — Capa visual del bloqueo (DELICADO, toca la grilla).**
Badge "🔁 Fijo" en `BloqueReserva` para reservas con `turno_fijo_id`.
Mostrar el **slot comprometido por turno fijo no materializado como
ocupado en la grilla** (bloque tipo "Reservado · Turno fijo · {titular}",
estilo distinto al reservado materializado, clickeable → link a
`/turnos-fijos`). Banner en `DetalleReservaDialog` con info del turno
fijo + link. **ANTES de empezar: diagnosticar y resolver el bug de
layout existente de la grilla** (ver sección anterior). Sin esto
arreglado, agregar bloques nuevos amplifica el problema. Hacer con
cabeza fresca, en sesión dedicada.

## Visión de producto: el turno como cuenta (tipo mesa de restaurante)

Cada turno/reserva debe funcionar conceptualmente como la mesa de un
restaurante: una cuenta abierta asociada al turno que acumula el alquiler
de la cancha MÁS los consumos (bebidas, compras del buffet), con soporte
para múltiples medios de pago, división de la cuenta entre los jugadores,
y cuentas diferenciadas (un jugador puede pagar algo extra además de su
parte de la cuenta compartida del turno).

Esta visión integra tres módulos: Reservas (el turno), Buffet/POS (los
consumos) y Caja (los medios de pago y la división). Se construye de
forma incremental:
- **Sprint 3a**: la reserva nace con monto de alquiler + estado de pago
  simple (pendiente/señado/pagado) + medio. El modelo de datos se diseña
  para que después se le puedan "colgar" consumos y división de cuentas.
- **Módulos Buffet y Caja**: se suman los consumos, los medios de pago
  múltiples, y la división/diferenciación de cuentas.

El documento maestro ya contempla esto en 8.1 (flujo B: cobrar saldo al
finalizar turno con buffet asociado) y 10.1 (cuenta corriente del turno).

**REQUISITO DE DISEÑO para Sprint 3a**: al modelar la tabla `reservas` y
sus pagos, dejar el modelo preparado para esta evolución (no cerrarlo de
forma que después haya que migrar datos para sumar buffet/división).

### División de la cuenta del turno (definición precisa)

La cuenta del turno acumula el alquiler de la cancha + los consumos de
buffet, y el sistema CALCULA cómo se divide (es una ayuda informativa para
cuadrar, NO un sistema de sub-cuentas formales por persona — el vendedor
ve cuánto le toca a cada uno y registra el cobro).

**Reglas de división del ALQUILER (Forma B, confirmada):**

- Cantidad de jugadores CONFIGURABLE por turno (no fijo en 4). Caso real:
  juegan 6 y se turnan, pagan entre 6. El vendedor indica cuántos jugadores
  participan.
- Parte justa de cada jugador = `monto_total_alquiler / cantidad_jugadores`.
- A cada jugador se le descuenta lo que YA pagó (ej. la seña se descuenta
  SOLO de quien la pagó).
- Ejemplo: cancha $48.000, 4 jugadores → parte justa $12.000 c/u. Si uno
  señó $10.000, ese debe $2.000 más; los otros 3 deben $12.000 c/u.
  (NO se reparte el saldo entre los que no pagaron; cada uno debe su parte
  justa menos lo que aportó.)

**Acompañantes que SOLO consumen (no juegan):**

- Se indica solo la CANTIDAD de personas extra (un número), sin cargar
  nombres ni fichas. No pagan alquiler, solo lo que consumieron del buffet.

**Consumos de buffet (cuando exista el módulo):**

- Se suman a la cuenta del turno. La división de consumos se definirá al
  construir el buffet (probablemente: o se reparten entre todos, o se
  asignan a personas puntuales).

**El cobro es INFORMATIVO**: el sistema muestra "a cada uno le toca $X"
para cuadrar; no exige registrar pago por persona. El modelo de datos ya
está preparado (`reserva_jugadores` = participantes, `reserva_pagos` con
`jugador_id` nullable, futura `reserva_items` para consumos).

**REQUISITO para el turno** (a sumar cuando se construya): poder indicar
la CANTIDAD de jugadores del partido (no asumir 4), porque la división
depende de eso.

## Requisitos pendientes para Buffet (Capa 1)

- **ANULAR / CORREGIR UNA VENTA DESDE LA UI** (admin): hoy la venta es
  inmutable desde la app — si hay un error de cobro la única manera de
  corregirlo es SQL manual, lo que no es viable para uso diario real.
  Falta una acción de admin que anule una venta y, atómicamente, revierta
  los movimientos de stock que generó (movimientos compensatorios
  positivos con fuente nueva tipo `'anulacion_venta'` o similar, NO
  borrado de filas históricas). Decidir si es "anular completa" o
  "anular ítem por ítem", la fuente exacta del movimiento compensatorio
  y los mensajes/confirmación. No se construye en Capa 1, pero queda
  registrado como necesario antes del uso diario real del módulo.

## Visión de producto: Buffet (a futuro)

- **REPOSICIÓN DE STOCK POR FACTURAS DE COMPRA VÍA BOT DE WHATSAPP**: a
  futuro, el club quiere poder subir las facturas de compra de
  proveedores a través de un bot de WhatsApp, que lea la factura y
  actualice/reponga el stock de los productos del buffet automáticamente.
  Es un módulo grande propio (integración WhatsApp + parsing de facturas
  + movimientos de stock). **REQUISITO DE DISEÑO** para el buffet base:
  modelar el stock de forma que los movimientos (entradas por compra,
  salidas por venta) se puedan registrar y auditar, dejando lugar para
  que las entradas vengan después de una fuente externa (las facturas)
  sin migración destructiva.

- **CONTABILIDAD / COMPROBANTES FISCALES**: las ventas del buffet hoy son
  registro interno (sin ticket fiscal). A futuro, el club quiere meterse
  en la contabilidad formal (comprobantes, facturación). **REQUISITO DE
  DISEÑO**: que el registro de ventas quede preparado para sumar
  numeración de comprobantes y datos fiscales más adelante, sin rehacer
  el modelo.

## Visión de producto: rentabilidad y EERR por unidad de negocio

**OBJETIVO**: el club quiere ver su rentabilidad completa en un Estado de
Resultados (EERR) desglosado, con análisis POR UNIDAD DE NEGOCIO.

**UNIDADES DE NEGOCIO**: Alquileres (reservas), Clases, Buffet. Cada
ingreso y cada gasto debe poder etiquetarse con su unidad (o "general"
si es transversal), para calcular rentabilidad por unidad.

**ESTRUCTURA DEL EERR**:

- Ingresos por unidad: Alquileres (pagos de reservas), Clases
  (clase_cobros), Buffet (ventas).
- Costos directos: SOLO el buffet tiene costo directo (costo de mercadería
  vendida = costo del producto × cantidad). Alquileres y Clases NO tienen
  costo directo (no se paga a profesores; el club solo cobra alquiler).
- Margen por unidad = ingresos − costo directo.
- Gastos fijos del club (alquiler local, servicios, sueldos, mantenimiento,
  impuestos): se restan del margen total. Opcionalmente prorrateables por
  unidad a futuro; por ahora globales.
- Resultado neto = suma de márgenes − gastos fijos.

**DECISIONES TOMADAS**:

- Costo de productos: MANUAL (campo en el producto) + ÚLTIMO COSTO
  CONOCIDO (no promedio ponderado por ahora). El margen de cada venta =
  precio − costo al momento de la venta (snapshot, como ya hacemos con el
  precio).
- Rentabilidad POR UNIDAD DE NEGOCIO (no solo global).
- Clases = ingreso por **alquiler de cancha al profesor** (ver
  "Replanteo: Clases como alquiler de cancha" en Deudas funcionales
  prioritarias). El modelo actual mapea el ingreso a la unidad "Clases"
  separada de "Canchas" — está desalineado y hay que corregirlo.

**ORDEN DE CONSTRUCCIÓN DEFINIDO**:

1. Costo en productos (cerrar buffet con su margen). ✓ hecho
2. Módulo Gastos (gastos fijos categorizados + etiquetables por unidad). ✓ hecho
3. Módulo Caja (unifica todos los ingresos + gastos en un flujo de
   dinero). ✓ hecho
4. Reportes / EERR por unidad de negocio. **Frontend básico hecho;
   pendiente rediseño completo (ver Deudas funcionales prioritarias).**

## Deudas funcionales prioritarias

**🔴 PRIORITARIO — Cancelar aumento programado de tarifa**: la migración
0029 introduce el flujo "Cambiar precio" con aumentos a futuro (ej.
"desde el 1/06 sube a $52.000"). Si un admin lo carga por error, hoy
la única forma de revertirlo es vía SQL manual (DELETE de la versión
futura + UPDATE vigente_hasta=NULL de la versión actual). Un admin no
técnico no debería tener que pasar por soporte para deshacer un aumento
mal cargado. Construir `fn_cancelar_aumento_programado` + botón
"Cancelar este aumento" en la pantalla de Tarifas. No es deuda que
duerme.

**🟠 REPLANTEO: Clases como alquiler de cancha**: confirmado con el
dueño que en este club el profesor cobra a los alumnos directamente
(el club NO recibe ese dinero). El club solo cobra el **alquiler de la
cancha** donde se da la clase. El modelo actual (`clases.precio` como
número fijo, ingreso mapeado a unidad "Clases" separada) está
desalineado con la realidad del negocio. Plan acordado:

  1. Renombrar UI "Precio" → "Alquiler de cancha por clase".
  2. Mapear el ingreso de `clase_cobros` a la unidad **"Canchas"** en
     `useResumenFinanciero` y el resto del módulo financiero (no a
     "Clases" como hoy).
  3. Evaluar reemplazar `clases.precio` por `fn_resolver_tarifa(fecha,
     hora_inicio)` para consistencia con el modelo de tarifas
     versionadas (0029). Si la tarifa de cancha cambia, el alquiler de
     las clases que ocurren en ese horario se actualiza automático.

  Conceptualmente, **una clase ES un turno fijo del profesor**. NO se
  decidió fusionar las entidades (camino C descartado por invasivo) —
  solo alinear semánticamente. Las clases siguen siendo entidad propia.

**🟠 PLANIFICACIÓN DE PROFESORES**: cargar todas las clases de los
profes de una vez (equivalente a turnos fijos pero para clases) para
estimar ocupación futura del club y proyección financiera del alquiler
recurrente al profesor. UX similar a la carga masiva de turnos fijos
("Guardar y seguir agregando"). Va junto con el replanteo de Clases.

**🟠 SIMULADOR DE ALZA DE INGRESOS**: "si subo X% las tarifas, cuánto
más facturo" sumando turnos fijos + alquiler de clases proyectados con
tarifa hipotética. Se apoya en `useProyeccionTurnosFijos` (Parte 3 de
Turnos Fijos, pendiente) reusando el mismo cálculo con un parámetro de
"factor de ajuste" o "tarifa hipotética por linaje". UI: simulador en
`/finanzas` o `/configuracion/tarifas`. NO modifica datos, solo
proyección de cálculo.

**🟠 REDISEÑO MÓDULO FINANCIERO** (visión "Club Operating System" por
fases): el frontend financiero actual quedó básico. Pendiente:

  - Centros de ingreso vs estructura: que las unidades de tipo
    `estructura` NO aparezcan como opción al cargar ingresos (solo
    para gastos). Hoy el form mezcla todas.
  - **Gastos recurrentes esperados con alarmas**: sistema proactivo
    que avisa si falta cargar un gasto habitual (ej. "El alquiler del
    local no se cargó este mes"). Requiere modelar "gasto esperado"
    + recordatorio.
  - **EERR con capas correctas**: ingreso − costo de lo vendido
    (`venta_items.costo_unitario` ya existe, NO recargar) − gastos
    directos por unidad − estructura = resultado neto. Hoy el EERR
    está armado pero la presentación es básica.
  - Rediseño visual del hub `/finanzas` con la mirada de un experto
    financiero (no del dueño operativo).

## Deudas técnicas

- **Trigger BEFORE INSERT en `reservas`** como defensa en profundidad
  del bloqueo de slot de turno fijo (0031). Hoy la validación vive
  solo en `fn_crear_reserva`. Como el frontend SIEMPRE usa la RPC,
  cubre el 100% del caso real, pero un INSERT directo desde Supabase JS
  (caso edge, no es nuestro flujo) lo evadiría. Trigger BEFORE INSERT
  que distinga por `NEW.turno_fijo_id IS NULL` (suelta, valida) vs NOT
  NULL (materialización, no toca) sería la defensa última.

- **Mismo patrón de vigencia temporal** (lineage_id + vigente_desde/
  hasta + EXCLUDE) para `clases.precio` y futuras `membresias`. Hoy
  solo `tarifas` tiene el modelo versionado. Cuando se replantee
  Clases como alquiler de cancha, evaluar si conviene moverlas
  directamente a `fn_resolver_tarifa` (que ya está versionado) o
  versionar `clases.precio` independientemente. Membresías nace con
  vigencia temporal desde el inicio.

- **LIMPIAR data de prueba** que quedó en la base por ensayos en la
  app durante el desarrollo. Ej. una reserva en estado "pagada"
  huérfana en cancha 1 a las 19:00, posibles turnos fijos de prueba,
  cobros de clases de prueba. Limpiar con cuidado identificando qué
  es de prueba vs qué es real (consultar al dueño si dudás).

## Deudas de seguridad detectadas

**DEUDA DE SEGURIDAD (no urgente)**: el rol authenticated recibe permisos de
escritura (INSERT/UPDATE/DELETE) por DEFAULT sobre las tablas nuevas del
schema public en este proyecto. La barrera efectiva siempre fue la RLS
(policies), real y suficiente. Para defensa en capas, conviene auditar
todas las tablas y REVOKE los permisos de escritura que no correspondan a
authenticated. En la 0019 se revocó explícitamente en modulos/planes/
plan_modulos/plataforma_admins. La 0029 también revocó DELETE en tarifas.
La 0033 sumó GRANT DELETE explícito en turnos_fijos (admin-only por
policy). El resto pendiente.
