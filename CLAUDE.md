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
