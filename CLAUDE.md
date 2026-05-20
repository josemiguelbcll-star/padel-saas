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
