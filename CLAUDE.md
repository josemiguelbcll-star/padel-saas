# Proyecto: SaaS de gesti?n para clubes de p?del

## Documento maestro
Este proyecto se construye siguiendo el Documento T?cnico Maestro v1.0
ubicado en docs/Documento_Tecnico_Maestro.docx. TODA decisi?n t?cnica
debe estar alineada con ese documento. Si algo no est? cubierto ah?,
preguntar antes de inventar.

## Atributos de calidad (norte del proyecto)
1. Disponibilidad (uptime 99.5%% m?nimo)
2. Integridad de datos (transacciones at?micas)
3. Seguridad multi-tenant (RLS estricta)
4. Performance operativa (grilla <1s, POS <200ms)
5. Confiabilidad y recuperaci?n (Sentry, backups)
6. Mantenibilidad

## Stack t?cnico
- Frontend: Vite + React 18 + TypeScript estricto
- UI: Tailwind CSS + shadcn/ui
- Data: @supabase/supabase-js + @tanstack/react-query
- Router: react-router-dom v6
- Validaci?n: zod
- Errores: @sentry/react
- Backend: Supabase (Postgres + Auth + RLS + Edge Functions)

## Reglas no negociables
1. RLS habilitada en TODAS las tablas, sin excepci?n.
2. Toda tabla de negocio tiene club_id BIGINT NOT NULL.
3. Toda pol?tica de INSERT/UPDATE lleva WITH CHECK.
4. NUNCA usar service_role_key en el frontend.
5. NUNCA usar 'any' en TypeScript sin justificaci?n.
6. Operaciones multi-tabla van en funciones RPC, no en frontend.
7. Tokens visuales como CSS custom properties, NO hardcodeados.
8. Estructura por feature, NO por tipo de archivo.
9. Las migraciones SQL no se modifican una vez ejecutadas.

## Flujo de trabajo
1. ANTES de generar c?digo, mostrar el plan: qu? archivos vas a crear.
2. NO instalar dependencias nuevas sin avisar.
3. NO crear migraciones SQL sin avisar.
4. NO modificar pol?ticas RLS existentes sin avisar.
5. Si una tarea es ambigua, preguntar antes de asumir.
