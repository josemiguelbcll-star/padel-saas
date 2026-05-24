# Informe de UX — Padel SaaS

**Proyecto:** `padel-saas` · Sistema de gestión para clubes de pádel
**Stack:** React + TypeScript + Vite + Tailwind + shadcn/ui + Supabase + React Query
**Alcance del análisis:** Visión general de toda la aplicación
**Enfoque:** Crítica de UX general (usabilidad, jerarquía, consistencia, estados, feedback)
**Fecha:** 24 de mayo de 2026

---

## 1. Resumen ejecutivo

Padel SaaS es una base sólida y bien construida. El código revela un equipo (o desarrollador) con criterio: hay un sistema de design tokens limpio, componentes consistentes basados en shadcn/ui, estados de carga y error cuidados en casi todas las pantallas, y una atención a la accesibilidad superior al promedio de los SaaS comparables. No es un proyecto con "problemas de UX graves" — es un proyecto bueno al que le faltan detalles de pulido y consistencia para sentirse terminado.

Los hallazgos se concentran en tres temas: **feedback al usuario** (no hay forma unificada de confirmar que una acción salió bien), **elementos placeholder visibles** (la app muestra UI que no funciona todavía), y **consistencia** (mismos problemas resueltos de formas distintas según la pantalla). Ninguno es difícil de resolver; el informe los ordena por impacto y al final entrega prompts listos para pegar en Claude Code y aplicarlos.

El balance general: corregir los tres hallazgos de prioridad alta elevaría notablemente la sensación de producto terminado, con un esfuerzo de implementación moderado.

---

## 2. Lo que ya está bien

Vale la pena empezar por acá, porque define el estándar de calidad del proyecto y porque varias mejoras consisten en *extender* patrones que ya existen, no en inventar nada nuevo.

El **sistema de design tokens** (`src/styles/globals.css`) es ejemplar: todos los colores, radios y tipografía viven como variables CSS, con una paleta completa para modo claro y oscuro. Reskinear la app entera es cambiar un archivo.

Los **estados de carga, error y vacío** están contemplados en casi todas las pantallas. La grilla de reservas, las tablas de configuración, el dashboard y los diálogos muestran skeletons mientras cargan, banners de error con `role="alert"`, y mensajes de estado vacío redactados con criterio (por ejemplo, `CanchasPage` distingue el mensaje según si el usuario es admin o vendedor).

La **accesibilidad de base** es buena: hay `aria-label` en botones de ícono, `aria-busy` en skeletons, `aria-current="step"` en el wizard, `role="combobox"`/`listbox`/`option` en el autocompletado de jugadores, anillos de foco visibles (`focus-visible:ring`) en todos los elementos interactivos, y títulos ocultos (`sr-only`) donde Radix los necesita.

Las **acciones destructivas piden confirmación** (cancelar una reserva, eliminar una cancha) y los **banners de configuración pendiente** guían al usuario con enlaces directos a la pantalla que tiene que completar. El **manejo de errores de borde** en autenticación está especialmente cuidado (usuario sin club, sesión caída, club suspendido, usuario desactivado, cada uno con su pantalla dedicada).

---

## 3. Hallazgos priorizados

Cada hallazgo indica qué ocurre, dónde está en el código, y por qué importa.

### Prioridad alta

#### H1 — No existe un sistema de notificaciones; el feedback de éxito es inconsistente

La aplicación no tiene un sistema de *toasts* o notificaciones global (una búsqueda de `toast`/`sonner`/`Toaster` en todo `src/` no devuelve nada). Como consecuencia, cada acción confirma su éxito de una forma distinta, o no lo confirma:

- En `BuffetPage.tsx`, cerrar una venta muestra un banner verde temporal de ~5 segundos. Funciona bien.
- En `DetalleReservaDialog.tsx`, el botón **"Marcar jugada"** no da *ningún* feedback: la reserva cambia de estado en segundo plano y el único indicio es que el badge del diálogo se actualiza. El usuario no recibe confirmación explícita.
- En `CanchaFormDialog.tsx`, `NuevaReservaDialog.tsx` y `CerrarCajaDialog.tsx`, una operación exitosa simplemente cierra el diálogo. No hay confirmación de que se creó la reserva, se guardó la cancha o se cerró la caja.

**Impacto:** en un sistema operativo que se usa con clientes esperando en el mostrador, la ausencia de confirmación genera dudas ("¿se guardó?") y reintentos. Es el hallazgo de mayor impacto porque afecta a casi todas las interacciones de escritura.

#### H2 — La barra superior muestra elementos que no funcionan

En `Topbar.tsx` hay dos elementos *placeholder* visibles para el usuario final:

- El indicador **"Caja: cerrada"** está escrito a mano y siempre dice "cerrada", sin importar el estado real. El propio comentario del código lo reconoce ("se va a alimentar desde el módulo Caja en el próximo sprint"). Lo llamativo es que el dato real ya existe — el Dashboard lee el estado de la caja con `useCajaAbierta` — pero la Topbar no lo usa, así que puede contradecir al Dashboard en la misma pantalla.
- La **campana de alarmas** está deshabilitada y muestra un contador "0" fijo.

**Impacto:** mostrar UI no funcional erosiona la confianza. Un operador que vea "Caja: cerrada" mientras su caja está abierta va a desconfiar del resto de los números. Conviene ocultar estos elementos hasta que funcionen, o conectarlos a los datos reales.

#### H3 — Los mensajes de error pueden mostrar texto técnico crudo

El patrón de manejo de errores en mutaciones y queries es `err instanceof Error ? err.message : 'mensaje amigable'`. El problema es que los errores de Supabase y de red *son* instancias de `Error`, así que su mensaje técnico se muestra textualmente al usuario. `ReservasPage.tsx` y `CanchasPage.tsx`, por ejemplo, vuelcan `query.error.message` directo en un banner.

Cuando el mensaje viene de una función RPC con texto redactado para humanos, se ve bien. Pero un fallo de red ("Failed to fetch"), un timeout o una violación de constraint de Postgres se le mostraría tal cual a un encargado de club que no es técnico. Existe `mapAuthError` para normalizar errores, pero solo se usa en el login.

**Impacto:** mensajes incomprensibles o alarmantes en los momentos de fallo, justo cuando el usuario más necesita claridad.

### Prioridad media

#### H4 — El modo oscuro está definido pero es inalcanzable

`globals.css` tiene una paleta `.dark` completa y varios componentes ya usan variantes `dark:` (por ejemplo, los colores de KPIs en el Dashboard). Pero no hay ningún control para activarlo ni detección de `prefers-color-scheme` (no aparece `matchMedia`, `classList`, ni ningún toggle de tema en todo el código). En la práctica, el modo oscuro es código muerto: ningún usuario puede llegar a él.

**Impacto:** trabajo ya hecho que no rinde. Para clubes con mostradores de iluminación baja, el modo oscuro es una mejora real de confort. Falta solo el interruptor.

#### H5 — La asociación de errores de formulario para lectores de pantalla es inconsistente

Algunos formularios vinculan correctamente el mensaje de error con su campo vía `aria-describedby` (`EditarUsuarioDialog`, `NuevoVendedorDialog`, `MarcaPage`). Pero los formularios de mayor tráfico — `LoginPage`, `NuevaReservaDialog`, `CanchaFormDialog`, `CerrarCajaDialog` — usan solo `aria-invalid`. Un lector de pantalla anuncia "campo inválido" pero no lee *por qué*.

**Impacto:** accesibilidad degradada en los flujos más usados. Es además una inconsistencia: el patrón correcto ya existe en el proyecto, solo no se aplicó en todos lados.

#### H6 — Las pantallas de error y "no encontrado" son callejones sin salida

`NotFoundPage.tsx` muestra un texto ("Sección no disponible") sin ningún botón o enlace para volver al inicio. El *fallback* de error global en `main.tsx` le dice al usuario "Refrescá la página" pero no ofrece un botón para hacerlo. En ambos casos el usuario tiene que resolver solo cómo salir.

**Impacto:** menor, pero es un detalle de pulido que se nota. Una vía de salida explícita es estándar.

#### H7 — No hay límite de error por ruta

La app tiene un único `Sentry.ErrorBoundary` en la raíz (`main.tsx`). Si una sola pantalla lanza una excepción de render, cae *toda* la aplicación al fallback global y la única salida es refrescar. Un límite de error a nivel de ruta dejaría el resto de la app navegable y permitiría reintentar solo la pantalla afectada.

**Impacto:** un bug aislado en una pantalla secundaria tira abajo toda la sesión de trabajo.

#### H8 — En la grilla del día, la columna de horas se pierde al hacer scroll horizontal

`GrillaDia.tsx` envuelve la grilla en un contenedor `overflow-x-auto`. Con varias canchas, el usuario hace scroll horizontal — pero la columna de horarios scrollea junto con las canchas y desaparece, así que se pierde la referencia de a qué hora corresponde cada bloque. Tampoco hay una pista visual de que hay más contenido a la derecha.

**Impacto:** dificulta la lectura de la grilla en clubes con muchas canchas, que es justamente el caso donde la grilla más se necesita.

### Prioridad baja

#### H9 — Los estados de carga no son visualmente uniformes

Conviven tres formas de comunicar "cargando": skeletons con animación *pulse* (lo más común), texto plano "Cargando…" (`LoginPage`, el resumen de `CerrarCajaDialog`) y un *overlay* con la frase "Cargando reservas…". Unificar bajo un patrón único daría una sensación más pulida.

#### H10 — El título de la pestaña del navegador nunca cambia

No se asigna `document.title` en ninguna ruta. Todas las pestañas del navegador se ven idénticas. Para un operador que trabaja con Reservas y Caja abiertas en dos pestañas — un caso de uso real — son indistinguibles.

#### H11 — Los grupos de botones tipo selector no usan semántica de radiogrupo

En `NuevaReservaDialog`, los selectores de "Estado" y "Medio de pago" son grupos de `<button>` con `aria-pressed`. Funcionan, pero no son un `radiogroup` real: no se navegan con flechas ni se anuncian como grupo. Para selección de una sola opción, el patrón de radiogrupo es el correcto.

#### H12 — Faltan detalles de navegación por teclado y de arquitectura de información

No hay un enlace "saltar al contenido" para usuarios de teclado. Y hay dos patrones distintos de confirmación destructiva para acciones de severidad parecida: confirmación *inline* al cancelar una reserva, diálogo modal al eliminar una cancha. Unificar el criterio mejora la previsibilidad.

---

## 4. Mejoras para implementar con Claude Code

Esta sección convierte cada hallazgo en un *prompt* listo para pegar en Claude Code. Están ordenados por prioridad. Conviene aplicarlos de a uno y revisar el diff antes de pasar al siguiente.

### Para H1 — Sistema de notificaciones

> En el proyecto `padel-saas` no existe un sistema de notificaciones (toasts). Quiero agregar uno y usarlo de forma consistente. Instalá y configurá `sonner` (es compatible con shadcn/ui), montá el `<Toaster />` en `AppShell.tsx` o en `main.tsx`, y luego recorré estas operaciones para mostrar un toast de éxito cuando terminan bien: crear reserva (`NuevaReservaDialog`), guardar/crear cancha (`CanchaFormDialog`), "Marcar jugada" y guardar observaciones (`DetalleReservaDialog`), cerrar caja (`CerrarCajaDialog`) y cerrar venta (`BuffetPage`). Para el cierre de venta, reemplazá el banner temporal actual por el toast para no duplicar feedback. Mantené el estilo visual con los design tokens existentes. Mostrame el plan antes de tocar archivos.

### Para H2 — Placeholders de la Topbar

> En `src/components/layout/Topbar.tsx` hay dos elementos placeholder que no funcionan: el indicador "Caja: cerrada" (hardcodeado) y la campana de alarmas (deshabilitada con un "0"). Quiero dos opciones evaluadas: (a) conectar el indicador de caja al estado real usando el hook `useCajaAbierta` que ya existe y se usa en el Dashboard, y (b) si conectarlo es complejo, ocultar ambos elementos hasta que sus módulos estén listos. Recomendame cuál conviene y por qué, y aplicá la opción (a) para el indicador de caja si es viable. La campana dejala oculta hasta que exista el módulo de alarmas.

### Para H3 — Normalización de mensajes de error

> En `padel-saas`, los errores se muestran al usuario con `err.message` crudo, lo que puede exponer texto técnico de Supabase o de red. Existe `mapAuthError` en `src/features/auth/authErrors.ts` pero solo se usa para login. Quiero una función general `mapError(err)` en `src/lib/` que traduzca errores comunes (fallo de red, timeout, errores de Postgres/Supabase) a mensajes en español claros para un usuario no técnico, y que use el `err.message` solo cuando ya es un mensaje redactado por una RPC. Después aplicala en los catch de las mutaciones y en los banners de error de queries (`ReservasPage`, `CanchasPage` y similares). Proponé primero la lista de casos que vas a mapear.

### Para H4 — Activar el modo oscuro

> El proyecto `padel-saas` tiene una paleta de modo oscuro completa en `src/styles/globals.css` (clase `.dark`) y componentes que ya usan variantes `dark:`, pero no hay forma de activarlo. Quiero un `ThemeProvider` que: detecte `prefers-color-scheme` como valor inicial, permita elegir entre claro / oscuro / sistema, persista la preferencia, y aplique/quite la clase `.dark` en el `<html>`. Agregá un selector de tema en el menú del avatar de la Topbar (`Topbar.tsx`), junto a "Cerrar sesión". No persistas en `localStorage` si vas a generar un artifact; en la app real `localStorage` está bien.

### Para H5 — Accesibilidad de errores de formulario

> En `padel-saas`, algunos formularios asocian el mensaje de error con su campo vía `aria-describedby` (`EditarUsuarioDialog`, `NuevoVendedorDialog`, `MarcaPage`) pero otros de alto tráfico no: `LoginPage`, `NuevaReservaDialog`, `CanchaFormDialog` y `CerrarCajaDialog` usan solo `aria-invalid`. Actualizá esos cuatro formularios para que cada `<p>` de error tenga un `id` y el `Input`/control correspondiente lo referencie con `aria-describedby` cuando hay error. Seguí exactamente el patrón que ya usa `NuevoVendedorDialog`.

### Para H6 y H7 — Vías de salida y límites de error

> En `padel-saas` quiero mejorar la recuperación ante errores. Primero: en `NotFoundPage.tsx` agregá un botón o enlace para volver al Dashboard, y en el fallback de error global de `main.tsx` agregá un botón "Refrescar" que haga `window.location.reload()`. Segundo: agregá un componente `RouteErrorBoundary` y envolvé con él cada elemento de ruta dentro del `<Route path="/">` en `App.tsx`, de modo que si una pantalla falla al renderizar, el resto de la app (Sidebar, Topbar, navegación) siga funcionando y se pueda reintentar solo esa pantalla. Reutilizá el estilo visual del fallback que ya existe.

### Para H8 — Columna de horas fija en la grilla

> En `src/features/reservas/GrillaDia.tsx`, la grilla está dentro de un contenedor `overflow-x-auto`. Cuando hay muchas canchas y se hace scroll horizontal, la columna de horarios scrollea y desaparece. Quiero que la columna de horas quede fija (sticky) a la izquierda durante el scroll horizontal, manteniendo el alineamiento de filas con las columnas de cancha. Agregá además una pista visual sutil (por ejemplo, una sombra en el borde) que indique que hay más canchas hacia la derecha. No cambies la lógica de cálculo de slots ni de posicionamiento de bloques.

### Para H9 a H12 — Pulido de consistencia

> En `padel-saas` quiero aplicar varias mejoras chicas de consistencia. (1) Crear un componente único de carga (skeleton + variante de texto) y reemplazar los "Cargando…" sueltos de `LoginPage` y `CerrarCajaDialog` para unificar el patrón. (2) Setear `document.title` por ruta — proponé un hook `usePageTitle` y aplicalo en las pantallas principales. (3) En `NuevaReservaDialog`, convertir los grupos de botones de "Estado" y "Medio de pago" en radiogrupos accesibles (`role="radiogroup"` con navegación por flechas), conservando el aspecto visual actual. (4) Recomendame un criterio único para confirmaciones destructivas (inline vs modal) y dejá una nota de cuál usar en cada caso. Hacelo en pasos separados y mostrame el diff de cada uno.

---

## 5. Cómo sacarle más a Claude Code en este proyecto

Más allá de los hallazgos puntuales, algunas formas de trabajar que rinden bien en un proyecto como este:

**Dale contexto visual cuando se trate de UX.** El código cuenta la mitad de la historia. Una captura de pantalla de la grilla del día, del diálogo de nueva reserva o del dashboard le permite a Claude Code señalar problemas de jerarquía, contraste y espaciado que no se ven leyendo `.tsx`. Pegá la imagen junto al pedido.

**Pedí el plan antes del cambio.** En pedidos que tocan varios archivos (como H1 o H3), agregá "mostrame el plan antes de tocar archivos". Revisás el enfoque antes de que escriba código y evitás retrabajo.

**Aprovechá que el proyecto ya tiene patrones fuertes.** Frases como "seguí el patrón que ya usa `NuevoVendedorDialog`" o "usá los design tokens de `globals.css`" producen resultados mucho más consistentes que descripciones abstractas. Este proyecto es ideal para eso porque sus patrones son claros.

**Considerá el plugin de Design.** Para auditorías de UX recurrentes — crítica de pantallas, revisión de accesibilidad WCAG, revisión de UX copy — el plugin **Design** de Cowork agrupa skills específicas (`design-critique`, `accessibility-review`, `ux-copy`) que estructuran este tipo de análisis y lo hacen repetible.

**Cerrá el ciclo con verificación.** Después de un cambio de UX, pedí "tomá una captura de la pantalla X y verificá que se ve bien" o "revisá el diff y confirmá que no rompiste otros usos del componente". El paso de verificación atrapa regresiones temprano.

---

## 6. Nota de método

Este informe se basa en la lectura directa del código fuente del proyecto: estructura completa de `src/`, archivos de layout (`AppShell`, `Sidebar`, `Topbar`), enrutamiento (`App.tsx`), pantallas de autenticación, el flujo de onboarding, el módulo de reservas completo (grilla, diálogos de nueva reserva y de detalle, autocompletado de jugadores), el dashboard, el módulo de buffet, el de caja, y pantallas y diálogos de configuración. Cada hallazgo está anclado a un archivo concreto y verificado contra el código, no inferido.

El análisis es estático: revisa el código, no la aplicación en ejecución. Algunos aspectos de UX — rendimiento percibido, fluidez de animaciones, comportamiento real en pantallas chicas, contraste exacto renderizado — se confirman mejor con la app corriendo y con capturas. Si compartís capturas de las pantallas principales, el análisis se puede afinar sobre esa base.
