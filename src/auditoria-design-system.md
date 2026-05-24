# Auditoría del Design System — Padel SaaS

**Proyecto:** `padel-saas` · Sistema de gestión para clubes de pádel
**Tipo:** Auditoría completa del sistema de diseño (`/design-system audit`)
**Stack:** React + TypeScript + Vite + Tailwind CSS + shadcn/ui
**Fecha:** 24 de mayo de 2026

---

## Resumen de la auditoría

**Componentes UI revisados:** 8 primitivos · **Archivos de feature analizados:** ~100 · **Issues encontrados:** 9 · **Score:** **68 / 100**

El veredicto en una frase: **la capa de tokens es excelente, la capa de componentes está a medio construir.** El proyecto tiene una base de diseño profesional — variables CSS bien organizadas, modo claro/oscuro completo, una regla explícita de "nada hardcodeado". Pero esa regla se cumple solo a nivel de *chrome* (colores de marca, fondos, bordes). En tipografía, color semántico de dinero y la biblioteca de componentes reutilizables, el sistema todavía no llegó. El resultado es que el código de las pantallas reinventa los mismos patrones una y otra vez con cadenas de Tailwind copiadas a mano.

Llevar el proyecto "a un nivel superior" no pasa por rediseñar nada: pasa por **terminar el design system** — cerrar las tres brechas de tokens y construir los 6-7 componentes que las features hoy reimplementan.

---

## Diagnóstico: la fortaleza y el techo

### La fortaleza

`src/styles/globals.css` y `tailwind.config.ts` forman un sistema de tokens de color de calidad real. Cada color se define como componentes HSL en una variable CSS, Tailwind los expone con soporte de opacidad (`hsl(var(--token) / <alpha-value>)`), y hay una paleta paralela completa para modo oscuro. Los radios están tokenizados (`--radius-sm/md/lg`). Los cinco estados de reserva y el color de clase tienen tokens dedicados con su par de `foreground`. El comentario de cabecera del config lo resume bien: *"para reskinear la app entera basta con cambiar las vars en globals.css"*. Para los colores de chrome y de estado, eso es literalmente cierto.

Los 8 componentes primitivos (`button`, `input`, `label`, `dialog`, `sheet`, `dropdown-menu`, `avatar`, `switch`) son shadcn/ui estándar, correctos, con `cva` para variantes donde corresponde, y buena accesibilidad de base.

### El techo

El sistema tiene un techo en tres lugares, y es ese techo lo que baja el score de ~90 a 68:

1. **No hay escala tipográfica.** El único token de tipografía es la familia de fuente. No hay tokens de tamaño, peso ni interlineado. La consecuencia se mide: **241 usos de tamaños de fuente arbitrarios** (`text-[10px]`, `text-[11px]`, `text-[13px]`…) repartidos en **61 archivos**. Cada pantalla define su micro-tipografía a ojo.

2. **No hay color semántico de "positivo / negativo".** El sistema tokeniza los estados de reserva, pero no el caso más transversal de un SaaS financiero: ingreso vs egreso, sobrante vs faltante. Eso se resuelve con clases de paleta cruda de Tailwind — **106 usos de `text-emerald-600` / `text-red-600` y similares en 25 archivos**, cada uno con su `dark:` a mano.

3. **La biblioteca de componentes es delgada.** Con solo 8 primitivos, las features reimplementan a mano patrones que deberían ser componentes: tarjetas, tablas, badges, textareas, banners de alerta, grupos de selección. El mismo bloque de `className` aparece copiado en decenas de archivos. Ahí es donde se filtra la inconsistencia.

Ninguna de las tres es difícil de cerrar. Las tres juntas son, exactamente, el trabajo de "nivel superior".

---

## Consistencia de naming

Esta es una buena noticia: el naming es de lo más sólido del proyecto.

| Aspecto | Estado | Observación |
|---|---|---|
| Tokens de color | Consistente | Patrón `--token` + `--token-foreground` uniforme en todo `globals.css`. |
| Componentes UI | Consistente | PascalCase, sub-componentes con prefijo (`DialogHeader`, `SheetContent`). Estándar shadcn. |
| Estructura de archivos | Consistente | Organización por feature (`features/<dominio>/`), respeta la regla del proyecto. |
| Idioma del dominio | Consistente | Dominio en español (`reservas`, `canchas`, `turnos-fijos`), primitivos en inglés. Decisión clara y sostenida. |
| Hooks | Consistente | Prefijo `use`, nombre por dominio (`useReservasDelDia`, `useCobrarReserva`). |

No se detectaron inconsistencias de naming que ameriten acción. El criterio existe y se respeta.

---

## Cobertura de tokens

| Categoría | Definido | Hardcodeos encontrados | Estado |
|---|---|---|---|
| Colores — chrome y marca | Completo (background, foreground, card, popover, primary, secondary, muted, accent, destructive, border, input, ring) | 0 | Excelente |
| Colores — estado | Completo (5 estados de reserva + clase, con `foreground`) | 0 | Excelente |
| Colores — semántico financiero | **Ausente** (no hay `--success` / `--danger` / positivo-negativo) | **106** usos de paleta cruda (`emerald`/`red`) en 25 archivos | Brecha crítica |
| Colores — paleta de gráficos | **Ausente** | **20** colores hex literales en `DashboardPage.tsx` y `EERRChartsRow.tsx` | Brecha |
| Tipografía | Solo familia (`--font-sans`) | **241** tamaños arbitrarios `text-[Npx]` en 61 archivos; sin escala de peso ni interlineado | Brecha crítica |
| Radios | Completo (`--radius-sm/md/lg`) | 0 | Excelente |
| Espaciado | Escala default de Tailwind (suficiente) | — | OK |
| Sombras / elevación | **Ausente** | `shadow-sm` / `shadow` / `shadow-md` / `shadow-lg` usados ad hoc | Brecha menor |
| Motion (duración / easing) | **Ausente** | `duration-200/300/500` ad hoc en `dialog` y `sheet` | Brecha menor |

**Estilos inline:** 56 usos de `style={{…}}` en 27 archivos. La mayoría son legítimos (posicionamiento absoluto en la grilla, donde `top`/`height` se calculan en runtime y *deben* ir inline). Pero un subconjunto son inline para *color* — `BloqueReserva`, `BloqueClase`, `CerrarCajaDialog` aplican color con `style` como workaround del cache del JIT de Tailwind sobre tokens custom. Eso es un síntoma de que faltan utilities de color bien definidas, no un problema en sí.

---

## Completitud de componentes

La columna "Docs" mide documentación formal (Storybook, MDX, fichas de componente). El proyecto tiene comentarios de código excelentes, pero documentación formal de componentes: ninguna.

| Componente | Estados | Variantes | Docs | Score |
|---|---|---|---|---|
| Button | ✅ | ✅ (6 variantes, 4 tamaños) | ❌ | 8/10 |
| Input | ⚠️ (sin estado de error propio) | ❌ (tamaño único) | ❌ | 5/10 |
| Dialog | ✅ | ✅ | ❌ | 7/10 |
| Sheet | ✅ | ✅ (4 lados) | ❌ | 7/10 |
| Dropdown Menu | ✅ | ✅ | ❌ | 7/10 |
| Switch | ✅ | ❌ (tamaño único) | ❌ | 6/10 |
| Avatar | ✅ | ❌ | ❌ | 6/10 |
| Label | ✅ | ❌ | ❌ | 6/10 |

### Componentes que faltan (y que las features ya reimplementan a mano)

Este es el corazón de la auditoría. Cada fila es un patrón que aparece copiado en muchos archivos porque no existe como componente:

| Componente faltante | Cómo se resuelve hoy | Dónde se repite |
|---|---|---|
| **Card** | `<article className="rounded-lg border border-border bg-card p-4">` escrito a mano | Dashboard, Finanzas, casi toda pantalla con tarjetas |
| **Table** | `<table>` + `<thead>`/`<tbody>` con clases repetidas | `CanchasPage` y todas las pantallas de Configuración |
| **Badge** | Funciones locales tipo `estadoBadgeClasses`, `<span>` con clases sueltas | `DetalleReservaDialog`, `EstadoClubBadge`, badge "Próx." del Sidebar |
| **Textarea** | `<textarea>` con un `className` largo idéntico copiado | `DetalleReservaDialog`, `CerrarCajaDialog` |
| **Alert / Banner** | `<div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 …">` | Decenas de archivos (error de formulario, error de query) |
| **Toast** | No existe; feedback de éxito ad hoc o ausente | Toda la app (ver auditoría de UX previa, hallazgo H1) |
| **ToggleGroup / SegmentedControl** | Grupos de `<button>` con `aria-pressed` a mano | `NuevaReservaDialog` (estado, medio de pago) |
| **Spinner / LoadingState** | Skeletons `animate-pulse` copiados; textos "Cargando…" sueltos | Toda la app |

Mientras estos patrones no sean componentes, cada pantalla nueva nace con un poco de deriva: un padding distinto, un `text-[11px]` donde otro usó `text-xs`, un borde de alerta con opacidad ligeramente diferente.

---

## Hallazgos detallados

**DS-1 — Sin escala tipográfica (crítico).** 241 tamaños arbitrarios en 61 archivos. Sin tokens de tamaño/peso/interlineado, la jerarquía tipográfica es una decisión que se vuelve a tomar en cada componente. Es la brecha de tokens de mayor alcance.

**DS-2 — Sin color semántico positivo/negativo (crítico).** 106 usos de `emerald`/`red` de paleta para representar dinero a favor/en contra, cada uno duplicando su variante `dark:`. Un cambio de criterio (por ejemplo, usar el verde de marca) obliga a tocar 25 archivos.

**DS-3 — Paleta de gráficos hardcodeada en hex.** 20 colores hex literales en `DashboardPage` y `EERRChartsRow`. Además, **defecto funcional**: en `EERRChartsRow`, `COLOR_GASTO` asigna el mismo `#ef4444` a `canchas`, `clases`, `buffet` y `shop` — cuatro categorías que en el gráfico se renderizan en rojo idéntico y no se pueden distinguir.

**DS-4 — Biblioteca de componentes incompleta (crítico).** 8 primitivos; faltan al menos 8 patrones de uso frecuente (Card, Table, Badge, Textarea, Alert, Toast, ToggleGroup, Spinner). Causa raíz de la mayor parte de la inconsistencia.

**DS-5 — `Input` sin estado de error propio.** El componente no tiene variante de error; cada formulario aplica `aria-invalid` y pinta el mensaje por fuera, con resultados desparejos (ver hallazgo H5 de la auditoría de UX).

**DS-6 — Inline styles de color como workaround del JIT.** Señal de que faltan utilities de color de estado confiables. Se resuelve al consolidar tokens de color de estado y verificar el `content` glob de Tailwind.

**DS-7 — Sin tokens de elevación (sombras).** `shadow-sm/md/lg` se eligen a ojo. Una escala de elevación (`--elevation-1/2/3`) daría consistencia de profundidad.

**DS-8 — Sin tokens de motion.** Duraciones de animación sueltas (`200/300/500ms`). Tokens de duración y easing unificarían la sensación de movimiento.

**DS-9 — Sin documentación formal de componentes.** No hay Storybook ni fichas. Para un sistema que va a crecer, "si no está documentado, no existe": el próximo desarrollador adivina variantes y estados leyendo el código.

---

## Acciones priorizadas — hoja de ruta a "nivel superior"

Ordenadas por impacto sobre la consistencia, y pensadas para hacerse en fases.

**Fase 1 — Cerrar las brechas de tokens (alto impacto, bajo riesgo).**

1. Definir una **escala tipográfica** como tokens (familia ya existe; sumar tamaños, pesos e interlineados) y mapearla a utilities de Tailwind. Migrar los `text-[Npx]` a la escala.
2. Agregar tokens semánticos **`--success` / `--danger`** (positivo / negativo) con su par claro/oscuro, y reemplazar los 106 usos de `emerald`/`red` crudo.
3. Mover la **paleta de gráficos** a tokens y, de paso, corregir el `#ef4444` repetido de `EERRChartsRow` para que cada categoría tenga su color.

**Fase 2 — Completar la biblioteca de componentes (alto impacto, riesgo medio).**

4. Construir `Card`, `Badge`, `Textarea` y `Alert` como componentes y migrar los usos reimplementados.
5. Construir `Toast` (resuelve también el hallazgo H1 de la auditoría de UX), `ToggleGroup` y un `LoadingState`/`Spinner` unificado.
6. Agregar variante de error a `Input`.

**Fase 3 — Pulido y gobernanza (impacto medio).**

7. Sumar tokens de elevación y de motion.
8. Documentar los componentes — Storybook es el estándar; como mínimo, una ficha por componente con variantes, estados y notas de accesibilidad.

Al terminar la Fase 1 el score sube a ~80; con la Fase 2, a ~90. La Fase 3 lo lleva al rango de sistema maduro.

---

## Prompts para aplicar con Claude Code

Listos para pegar. Conviene aplicarlos de a uno y revisar el diff.

**Escala tipográfica (DS-1)**

> En `padel-saas` no hay escala tipográfica: hay 241 usos de tamaños arbitrarios `text-[Npx]` en 61 archivos. Quiero definir una escala como tokens. Proponé primero una escala (por ejemplo xs/sm/base/lg/xl con tamaño, interlineado y peso sugerido), basada en los tamaños que el código ya usa de hecho. Sumá los tokens a `globals.css` y `tailwind.config.ts`, y después migrá los `text-[Npx]` a la escala feature por feature. Mostrame la escala propuesta antes de migrar nada.

**Color semántico positivo/negativo (DS-2)**

> En `padel-saas`, los montos a favor/en contra se pintan con `text-emerald-600`/`text-red-600` de la paleta cruda de Tailwind — 106 usos en 25 archivos, cada uno con su `dark:`. Quiero tokens semánticos `--success` y `--danger` (con par claro/oscuro) en `globals.css` y `tailwind.config.ts`, y reemplazar los usos de paleta cruda por esos tokens. No cambies los tonos visuales, solo centralizalos. Mostrame el plan antes de tocar archivos.

**Paleta de gráficos (DS-3)**

> En `padel-saas` los colores de gráficos están hardcodeados como hex en `DashboardPage.tsx` y `EERRChartsRow.tsx` (20 instancias). Movélos a tokens de paleta de datos. Además hay un defecto: en `EERRChartsRow.tsx`, el objeto `COLOR_GASTO` asigna el mismo `#ef4444` a canchas, clases, buffet y shop, así que en el gráfico se ven todas iguales. Asigná un color distinto y distinguible a cada categoría.

**Biblioteca de componentes (DS-4)**

> En `padel-saas` la carpeta `components/ui` tiene solo 8 primitivos y las features reimplementan a mano patrones repetidos. Quiero construir, siguiendo el estilo shadcn/ui ya presente y usando los design tokens existentes: `Card`, `Badge`, `Textarea` y `Alert`. Para cada uno, definí variantes y estados con `cva`, y después migrá los usos reimplementados (por ejemplo, las tarjetas `rounded-lg border bg-card` del Dashboard, los badges de estado de `DetalleReservaDialog`, los `<textarea>` de `DetalleReservaDialog` y `CerrarCajaDialog`, y los banners de error de destructivo repartidos por la app). Hacelo de a un componente, mostrando el plan de migración de cada uno.

**Documentación (DS-9)**

> Quiero documentar el design system de `padel-saas`. Configurá Storybook y creá una historia por cada componente de `components/ui`, cubriendo sus variantes y estados. Para los componentes con accesibilidad relevante, agregá una nota de rol ARIA y comportamiento de teclado. Empezá por `Button` e `Input` como referencia de formato.

---

## Nota de método

La auditoría se basa en la lectura directa del código: los 8 componentes de `src/components/ui/`, `tailwind.config.ts`, `src/styles/globals.css`, el layout, el enrutamiento y un recorrido amplio de las features. Las cifras de hardcodeos (241 tamaños arbitrarios, 106 colores de paleta, 20 hex, 56 estilos inline) provienen de búsquedas sobre todo `src/` y son verificables. El defecto del `#ef4444` repetido se confirmó leyendo `EERRChartsRow.tsx`.

Es un análisis estático del código. Para una auditoría de design system completa conviene además, en una segunda etapa, revisar el sistema *en ejecución* — contraste real renderizado, comportamiento responsive, consistencia de las animaciones — idealmente con capturas o con la app corriendo.

Por último: pediste también una revisión de **UX copy** (`/design:ux-copy`). Esta auditoría cubre el sistema de diseño (tokens y componentes); la revisión de textos — microcopy, mensajes de error, estados vacíos, CTAs — es un análisis aparte que puedo hacer a continuación si querés, sobre las mismas pantallas.
