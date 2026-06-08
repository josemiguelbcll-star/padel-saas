# MatchGo App — Documento Técnico v1.0
**"El número uno de la data del pádel en Salta"**

> Este documento define la visión completa del **player app de MatchGo**: la app
> móvil para jugadores de pádel (B2C) que se construye sobre el mismo backend del
> SaaS de gestión de clubes (B2B). La integración de ambas capas crea una
> plataforma de datos única en Salta.

---

## Índice

1. [Visión estratégica](#1-visión-estratégica)
2. [Arquitectura de la plataforma](#2-arquitectura-de-la-plataforma)
3. [Las 5 pantallas del player app](#3-las-5-pantallas-del-player-app)
4. [Sistema de rating (ELO adaptado)](#4-sistema-de-rating-elo-adaptado)
5. [Cuenta cross-club del jugador](#5-cuenta-cross-club-del-jugador)
6. [Schema de base de datos — adiciones](#6-schema-de-base-de-datos--adiciones)
7. [Push notifications — catálogo completo](#7-push-notifications--catálogo-completo)
8. [El flywheel de datos](#8-el-flywheel-de-datos)
9. [Roadmap de construcción](#9-roadmap-de-construcción)

---

## 1. Visión estratégica

### El problema que resuelve MatchGo

Los clubes de pádel en Salta gestionan sus reservas en papel, WhatsApp o sistemas
parciales. Los jugadores no tienen forma de:
- Ver su historial de partidos completo (cross-club)
- Saber dónde están parados en el ranking de la ciudad
- Desafiar a parejas de su mismo nivel de forma organizada
- Reservar cancha en cualquier club desde una sola app

### La ventaja competitiva: los datos

Cada reserva generada por el SaaS (B2B) es un dato de quién jugó, cuándo, dónde
y contra quién. Al conectar esos datos a los perfiles de jugadores (B2C) se crea
algo que ningún competidor tiene hoy en Salta:

**el historial completo del pádel salteño**.

Con suficientes clubes integrados, MatchGo se convierte en la fuente de verdad:
rankings, estadísticas, tendencias de horarios, clubes más activos, categorías más
jugadas. Eso tiene valor de publicidad, patrocinios y datos para los propios clubes.

### Los dos negocios que se refuerzan mutuamente

```
 CLUBES (B2B)                          JUGADORES (B2C)
 ─────────────────────────────────────────────────────
 Pagan suscripción mensual             Descargan la app gratis
 Gestionan reservas, caja, EERR        Reservan, desafían, ven su ranking
 Sus datos alimentan el ranking        El ranking los motiva a jugar más
         │                                      │
         └──────────── DATOS ──────────────────┘
                    (el moat real)
```

### Por qué Salta primero

- Mercado conocido (el dueño lo conoce)
- Suficiente masa crítica para un ranking con sentido (~500-2000 jugadores activos)
- Sin competidor directo con este modelo integrado
- Expansión a otras provincias replicando el playbook

---

## 2. Arquitectura de la plataforma

```
┌─────────────────────────────────────────────────────────┐
│                    Supabase Backend                      │
│  Postgres + Auth + RLS + Edge Functions + Realtime       │
├───────────────────────┬─────────────────────────────────┤
│   Schema CLUB (B2B)   │      Schema APP (B2C)           │
│   reservas            │      jugadores_app              │
│   canchas/tarifas     │      parejas                    │
│   ventas/caja         │      circulos / desafios        │
│   EERR/compras        │      partidos / ratings         │
│   club_fotos          │      logros / solicitudes       │
└───────────────────────┴─────────────────────────────────┘
         │                              │
         ▼                              ▼
┌─────────────────┐          ┌─────────────────────────┐
│  Panel Admin    │          │   MatchGo Player App    │
│  (web, B2B)     │          │   (Capacitor iOS+Android│
│  /app/*         │          │   + PWA fallback)       │
│  React + Vite   │          │   React + Vite          │
└─────────────────┘          └─────────────────────────┘
```

### Principios de arquitectura

- **Una sola base de código**: el player app vive dentro del mismo repo React/Vite,
  bajo rutas `/player/*`. Capacitor lo empaqueta como app nativa.
- **Cuenta cross-club**: el jugador tiene UN perfil (`jugadores_app`) vinculado a
  `auth.uid`. Puede jugar en 5 clubes distintos y su historial es unificado.
- **RLS estricta**: los jugadores ven sus datos y los datos públicos del círculo.
  Nunca ven datos financieros de clubes.
- **Offline-first para lo básico**: próxima reserva, historial reciente y ranking
  local cacheados para uso sin conexión.

---

## 3. Las 5 pantallas del player app

La app tiene una barra de navegación inferior con 5 tabs:

```
 🏠 Inicio   🔍 Explorar   ⚔ Desafíos   📊 Ranking   👤 Perfil
```

---

### 3.1 Inicio (Home)

La pantalla de llegada. Personalizada para el jugador.

**Secciones:**

```
┌─────────────────────────────────────┐
│  Buenas noches, José Miguel 👋       │
│  Pádel Salta Centro · 7mo puesto    │
├─────────────────────────────────────┤
│  PRÓXIMA RESERVA                    │
│  Sáb 13 jun · 20:00                 │
│  Signo D Padel · Cancha 2           │
│  [Ver detalle]  [Compartir]         │
├─────────────────────────────────────┤
│  ⚔ DESAFÍO PENDIENTE               │
│  Tomi G. + Santi R. te desafiaron   │
│  [Aceptar]  [Ver]                   │
├─────────────────────────────────────┤
│  ACTIVIDAD DEL CÍRCULO              │
│  · Diego R. + Nico F. ganaron 2-0   │
│  · Lucas B. + Fede M. desafiaron    │
│    a Marcos T. + Juli P.            │
│  · Nuevo miembro: Ramiro A. + ...   │
└─────────────────────────────────────┘
```

**Lógica:**
- Si hay desafío recibido → banner rojo pulsante arriba de todo
- Si hay partido a confirmar → banner amarillo
- Feed de actividad del círculo en tiempo real (Supabase Realtime)
- Próxima reserva: la más cercana en el tiempo de todas sus reservas activas

---

### 3.2 Explorar / Reservar

Descubrir clubes y reservar cancha sin salir de la app.

**Sub-pantallas:**

#### a) Mapa de clubes
- Mapa interactivo (Leaflet / Google Maps) con pins de todos los clubes MatchGo
- Cada pin muestra: nombre del club, cantidad de canchas disponibles AHORA
- Tap en pin → tarjeta del club con fotos, rating, horarios
- Filtro: "Mostrar solo con disponibilidad ahora"

#### b) Lista / buscador
```
┌─────────────────────────────────────┐
│  🔍 ¿A qué hora querés jugar?       │
│  [Hoy ▾]  [20:00 ▾]  [60 min ▾]   │
├─────────────────────────────────────┤
│  🟢 VALLE — ahora -30%              │
│  ┌──────────────────────────────┐   │
│  │ Signo D Padel               │   │
│  │ ⭐ 4.8 · 800m · 3 canchas   │   │
│  │ 14:00 $6.300 💚 valle        │   │
│  │ 15:30 $6.300 💚 valle        │   │
│  │ 19:30 $9.000                 │   │
│  └──────────────────────────────┘   │
│  ┌──────────────────────────────┐   │
│  │ La Bombonera Pádel          │   │
│  │ ⭐ 4.6 · 1.2km · 2 canchas  │   │
│  │ 18:00 $8.500                 │   │
│  │ 21:30 $9.500                 │   │
│  └──────────────────────────────┘   │
└─────────────────────────────────────┘
```

#### c) Flujo de reserva
1. Elegir slot → ver detalle del slot (cancha, precio, reglas del club)
2. Confirmar datos (cantidad de jugadores, ¿es un desafío?)
3. **Integración con desafíos**: "¿Este partido es un desafío? → vincular automáticamente"
4. Pago (futuro: MercadoPago / efectivo en el club)
5. Confirmación con código QR para presentar en el club

**Dato clave para el ranking**: cuando una reserva se marca como "partido de desafío",
el resultado confirma automáticamente en la escalera.

---

### 3.3 Desafíos *(ya prototipado)*

El feature social central. **Ya construido el prototipo visual.**

**Funcionalidades completas (más allá del prototipo):**

#### Círculo / Escalera
- Ladder de 8-16 parejas, cerrado, administrado por un organizador
- Solo podés desafiar a las 2 parejas que tenés arriba
- 4 días hábiles para aceptar o cedés el puesto
- Al aceptar → MatchGo sugiere slots de reserva disponibles

#### Múltiples círculos
- Un jugador puede pertenecer a más de un círculo
- Ej: "Círculo 6ta mañana" y "Círculo mixto nocturno"
- El perfil muestra tu posición en cada uno

#### Desafío abierto (futuro v2)
- Sin escalera, solo "te desafío a un partido amistoso"
- Se registra igualmente para el ranking global

#### Reglas configurables por círculo
- Formato (2 sets, super tie-break / 3 sets / etc.)
- Días de vigencia del desafío
- Si permite observadores
- Si el organizador debe confirmar resultados

---

### 3.4 Ranking & Data ⭐

**El diferenciador real. El que convierte MatchGo en "el número uno de la data".**

```
┌─────────────────────────────────────┐
│  📊 RANKING SALTA                   │
│  [Jugadores] [Parejas] [Clubes]     │
├─────────────────────────────────────┤
│  ESTA SEMANA                        │
│  🔥 76 partidos jugados en Salta    │
│  🏆 Club más activo: Signo D Padel  │
│  ⚡ Racha: Diego R. 8 victorias     │
├─────────────────────────────────────┤
│  TOP JUGADORES — 6ta categoría      │
│  #1 Diego R.    ████████ 1720 pts   │
│  #2 Caro V.     ███████  1685 pts   │
│  #3 Marcos T.   ██████   1610 pts   │
│  ...                                │
│  #7 José Miguel ████     1482 pts   │
│      (VOS)      ↑2 esta semana      │
├─────────────────────────────────────┤
│  [Ver ranking completo →]           │
└─────────────────────────────────────┘
```

**Sub-secciones:**

#### a) Ranking de jugadores
- Filtro por categoría (5ta, 6ta, 7ta, 8ta, abierto)
- Top 100 de Salta
- Tu posición siempre visible (fijada al fondo aunque no estés en top 100)
- Delta semanal (↑2, ↓1, →)
- Tap en jugador → ver perfil público (stats, historial, pareja actual)

#### b) Ranking de parejas
- Mejores duplas de la temporada
- Por círculo o global
- Racha activa más larga

#### c) Ranking de clubes
- Por canchas jugadas (actividad)
- Por rating promedio de jugadores (nivel del club)
- Por desafíos realizados (compromiso competitivo)

#### d) Estadísticas de Salta (la joya)
```
┌──────────────────────────────────────┐
│  📈 ESTADÍSTICAS DE SALTA — Jun 2026 │
├──────────────────────────────────────┤
│  Partidos este mes       342         │
│  Horas jugadas         1.026 h       │
│  Jugadores activos       284         │
│  Clubes participantes      6         │
├──────────────────────────────────────┤
│  MAPA DE CALOR DE HORARIOS           │
│  (cuándo se juega más en Salta)      │
│  Lun ░░░▓▓▓███▓▓░░                   │
│  Vie ░░░▓▓▓▓███████▓░                │
│  Sáb ████████████▓▓░░                │
├──────────────────────────────────────┤
│  EVOLUCIÓN DEL NIVEL                 │
│  Gráfico rating promedio Salta       │
│  Ene→Jun: +3.2% mejor nivel gral     │
└──────────────────────────────────────┘
```

#### e) Mi posición en el mapa
- Radar chart personal: Actividad / Nivel / Consistencia / Social
- Comparación con la media de tu categoría

---

### 3.5 Mi Perfil

La identidad digital del jugador. **Cross-club, acumulativa.**

```
┌─────────────────────────────────────┐
│  [foto]  José Miguel B.             │
│          6ta categoría              │
│          ⭐ 1.482 pts               │
│          📍 Salta Centro            │
├─────────────────────────────────────┤
│  MI PAREJA ACTUAL                   │
│  JM + PA   José Miguel & Pedro A.   │
│  #7 en Pádel Salta Centro           │
├─────────────────────────────────────┤
│  ESTADÍSTICAS GLOBALES              │
│  PJ  PG  PP  %V    Horas    Sets    │
│  22  13   9  59%   33h      108     │
├─────────────────────────────────────┤
│  EVOLUCIÓN DEL RATING               │
│  [gráfico línea — últimos 6 meses]  │
│  Ene: 1410 → Jun: 1482 (+72)        │
├─────────────────────────────────────┤
│  LOGROS                             │
│  🏆 10 victorias seguidas           │
│  📅 50 partidos jugados             │
│  🔥 3 desafíos en un mes            │
│  💎 Primera categoría               │
├─────────────────────────────────────┤
│  HISTORIAL DE PARTIDOS              │
│  [todos los clubes, todos los meses]│
│  Jun  Sáb 7  Signo D  2-1 ✓        │
│  May  Vie 30 Bombonera 1-2 ✗        │
│  ...                                │
├─────────────────────────────────────┤
│  MIS CÍRCULOS                       │
│  Pádel Salta Centro · #7            │
│  Mixto Nocturno · #3                │
└─────────────────────────────────────┘
```

**Perfil público** (lo que otros jugadores ven):
- Nombre, categoría, rating
- Stats básicas
- Pareja actual (con link al perfil de la pareja)
- Últimos 5 partidos
- Logros

**Perfil privado** (solo vos):
- Todo lo anterior +
- Reservas futuras
- Configuración de notificaciones
- Gestión de pareja (invitar, disolver)

---

## 4. Sistema de Rating (ELO adaptado)

### Por qué ELO

ELO es el estándar probado en ajedrez, tenis, fútbol amateur. Es simple,
transparente y justo: ganás más rating si le ganás a alguien mejor que vos.

### Adaptaciones para pádel en duplas

El rating es **de la pareja**, no individual. Pero cada jugador también tiene su
rating individual (promedio de las parejas en las que jugó, ponderado por partidos).

```
Rating nuevo = Rating viejo + K × (Resultado - Probabilidad esperada)

Donde:
  K = 32  (factor de cambio; más bajo en jugadores con muchos PJ)
  Resultado = 1 si ganaron, 0 si perdieron
  Probabilidad esperada = 1 / (1 + 10^((Rival.rating - Mi.rating) / 400))
```

### Ejemplo

Tu pareja (1482) vs rival (1560):
- Prob. esperada de ganar: 1 / (1 + 10^(78/400)) = 0.39 (39%)
- Si ganás: +32 × (1 - 0.39) = **+19 pts**
- Si perdés: +32 × (0 - 0.39) = **-12 pts**

**Reglas adicionales:**
- Rating inicial: 1400 pts para todos
- Solo se actualiza con partidos confirmados por ambas partes
- Partidos de desafío valen doble K (más competitivos)
- Partidos amistosos registrados valen K normal
- Categoría "automática": se recalcula según rating (cada 400 pts = una categoría)
- El rating **no baja debajo de 1200** (piso de dignidad)
- Primer mes: los 5 primeros partidos son "calibración" (K = 64)

### Historial de rating

Cada actualización genera una fila en `ratings_historial`. Esto permite:
- El gráfico de evolución personal
- Ver exactamente qué partido cambió cuánto
- Detección de anomalías (alguien cargando resultados falsos)

---

## 5. Cuenta cross-club del jugador

### El problema actual

Hoy la ficha de un jugador en MatchGo está atada a UN club (`club_id` en todas las
tablas). Si José Miguel juega en Signo D Padel Y en La Bombonera, tiene DOS fichas
desconectadas.

### La solución: `jugadores_app`

Una tabla nueva, **sin `club_id`**, vinculada al `auth.uid` de Supabase:

```sql
jugadores_app (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE REFERENCES auth.users(id),
  nombre_display TEXT NOT NULL,    -- "José Miguel B."
  nombre_corto TEXT NOT NULL,      -- "José Miguel" — para avatares
  foto_url TEXT,
  categoria_auto INTEGER,          -- calculada del rating
  rating INTEGER DEFAULT 1400,
  zona TEXT,                       -- "Salta Centro"
  created_at TIMESTAMPTZ DEFAULT now()
)
```

### Vinculación con fichas de clubes

Cuando un jugador se registra en la app e ingresa al club, se linkea:

```sql
jugador_app_club_link (
  jugador_app_id UUID REFERENCES jugadores_app(id),
  club_id BIGINT REFERENCES clubes(id),
  jugador_club_id BIGINT REFERENCES jugadores(id),  -- ficha del club
  PRIMARY KEY (jugador_app_id, club_id)
)
```

Esto permite que:
- El club sigue manejando sus fichas como siempre (sin romper nada)
- La app agrega el historial de TODOS los clubes del jugador
- Los ratings se unifican en un solo número

### Flujo de onboarding del jugador

1. Descarga la app → "Crear cuenta" (email + contraseña, o Google Sign-In)
2. Llena perfil básico: nombre, zona, categoría estimada
3. "¿En qué clubes jugás?" → busca y vincula sus fichas existentes
4. Primera vez en un club nuevo → el club confirma la vinculación (o escanea un QR)
5. Rating inicial: si tiene historial, se calibra; si no, 1400 pts de base

---

## 6. Schema de Base de Datos — Adiciones

> Todas las migraciones nuevas siguen la numeración existente (post-0063).
> Ninguna modifica tablas existentes; son SOLO adiciones.
> RLS habilitada en todas. Principios del CLAUDE.md respetados.

### Tablas nuevas (orden de migración)

```sql
-- 0064: jugadores_app (perfil cross-club)
-- 0065: jugador_app_club_link (vinculación)
-- 0066: parejas (duplas fijas)
-- 0067: solicitudes_pareja (invitar compañero)
-- 0068: circulos (grupos de desafío)
-- 0069: circulo_miembros (pareja → círculo, con posición)
-- 0070: desafios (challenge entre dos parejas)
-- 0071: partidos (resultado confirmado)
-- 0072: ratings_historial (log de cambios de rating)
-- 0073: logros (badges del jugador)
```

### Detalle de tablas clave

```sql
-- Pareja fija
CREATE TABLE parejas (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  jugador_a UUID NOT NULL REFERENCES jugadores_app(id),
  jugador_b UUID NOT NULL REFERENCES jugadores_app(id),
  activa BOOLEAN NOT NULL DEFAULT true,
  desde TIMESTAMPTZ NOT NULL DEFAULT now(),
  hasta TIMESTAMPTZ,  -- se llena al disolver
  rating INTEGER NOT NULL DEFAULT 1400,
  CONSTRAINT no_autopareja CHECK (jugador_a <> jugador_b),
  CONSTRAINT orden_jugadores CHECK (jugador_a < jugador_b)  -- evita duplicados
);

-- Desafío entre parejas
CREATE TABLE desafios (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  circulo_id BIGINT REFERENCES circulos(id),
  retador_pareja_id BIGINT NOT NULL REFERENCES parejas(id),
  retado_pareja_id  BIGINT NOT NULL REFERENCES parejas(id),
  estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente','aceptado','rechazado','expirado','jugado')),
  reserva_id BIGINT REFERENCES reservas(id),  -- link al turno real
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  vence_en TIMESTAMPTZ NOT NULL,  -- creado_en + 4 días hábiles
  CONSTRAINT no_autodesafio CHECK (retador_pareja_id <> retado_pareja_id)
);

-- Resultado del partido
CREATE TABLE partidos (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  desafio_id BIGINT UNIQUE REFERENCES desafios(id),  -- NULL = amistoso sin desafío
  pareja_a_id BIGINT NOT NULL REFERENCES parejas(id),
  pareja_b_id BIGINT NOT NULL REFERENCES parejas(id),
  sets_a INTEGER NOT NULL CHECK (sets_a BETWEEN 0 AND 3),
  sets_b INTEGER NOT NULL CHECK (sets_b BETWEEN 0 AND 3),
  confirmado_a BOOLEAN NOT NULL DEFAULT false,
  confirmado_b BOOLEAN NOT NULL DEFAULT false,
  confirmado_en TIMESTAMPTZ,  -- cuando ambos confirman → dispara rating update
  club_id BIGINT REFERENCES clubes(id),
  jugado_en TIMESTAMPTZ NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'desafio'
    CHECK (tipo IN ('desafio','amistoso','torneo'))
);

-- Log de rating
CREATE TABLE ratings_historial (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pareja_id BIGINT NOT NULL REFERENCES parejas(id),
  partido_id BIGINT REFERENCES partidos(id),
  rating_antes INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  rating_despues INTEGER NOT NULL GENERATED ALWAYS AS (rating_antes + delta) STORED,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Logros / badges
CREATE TABLE logros (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  jugador_app_id UUID NOT NULL REFERENCES jugadores_app(id),
  tipo TEXT NOT NULL,
  -- Tipos: 'primer_partido', '10_victorias', '50_partidos', 'racha_5',
  --        'racha_10', 'primer_desafio', 'categoria_subio', '100_partidos'
  conseguido_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (jugador_app_id, tipo)
);
```

### Edge Functions nuevas

```
push-register      → guarda token FCM/APNs del jugador
push-unregister    → elimina token al hacer logout
notify-desafio     → envía push cuando llega un desafío
notify-resultado   → envía push cuando el rival confirma
update-rating      → calcula y aplica ELO al confirmar ambas partes
check-logros       → verifica si el jugador ganó un badge nuevo
check-expiracion   → cron diario, expira desafíos vencidos
```

---

## 7. Push Notifications — Catálogo completo

| Tipo | Disparador | Título | Cuerpo | Deep link |
|------|-----------|--------|--------|-----------|
| `desafio_recibido` | Alguien te desafía | "⚔ Te desafiaron" | "Lucas B. + Fede M. te retaron al puesto #7" | `/desafios/{id}` |
| `desafio_aceptado` | Rival acepta | "✅ Desafío aceptado" | "Ani C. + Vale D. aceptaron. Coordiná el turno" | `/desafios/{id}` |
| `desafio_rechazado` | Rival rechaza | "❌ Desafío rechazado" | "Tomi G. + Santi R. rechazaron el desafío" | `/desafios` |
| `desafio_expirado` | Pasan 4 días | "⏰ Desafío expirado" | "No respondiste a tiempo. Cediste el puesto #6" | `/desafios` |
| `resultado_pendiente` | Partido jugado | "📋 Confirmá el resultado" | "¿Cómo terminó el partido vs Lucas B.?" | `/desafios/{id}/resultado` |
| `resultado_confirmado` | Ambos confirman | "🏆 Resultado oficial" | "2-1 vs Eze P. ¡Subís al puesto #6!" | `/ranking` |
| `solicitud_pareja` | Te invitan | "🤝 Solicitud de pareja" | "Pedro A. te invita a ser su pareja fija" | `/perfil/pareja` |
| `pareja_aceptada` | Pareja confirma | "🎉 ¡Pareja formada!" | "Ahora jugás con Pedro A. Busquen un círculo" | `/perfil` |
| `reserva_recordatorio` | 2h antes del turno | "🎾 En 2 horas jugás" | "Signo D Padel · Cancha 2 · 20:00" | `/reservas/{id}` |
| `nuevo_miembro_circulo` | Alguien entra | "👋 Nuevo rival" | "Ramiro A. + Bruno V. se unieron al círculo" | `/desafios/circulo` |
| `subiste_en_ranking` | Rating sube de pos | "📈 ¡Subiste!" | "Pasaste al puesto #6 en Pádel Salta Centro" | `/ranking` |

---

## 8. El Flywheel de datos

La razón por la que esto es un negocio y no solo una app:

```
                    ┌─────────────────────┐
                    │   MÁS CLUBES        │
                    │   se suman al SaaS  │
                    └─────────┬───────────┘
                              │ más datos
                              ▼
┌──────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│ JUGADORES    │────▶│   BASE DE DATOS     │────▶│  RANKING más     │
│ juegan más   │     │   del pádel salteño │     │  representativo  │
│ (motivados   │     │   (reservas,        │     │  y confiable     │
│ por ranking  │◀────│   resultados,       │◀────│                  │
│ y desafíos)  │     │   ratings)          │     │                  │
└──────────────┘     └─────────────────────┘     └──────────────────┘
       │                                                    │
       ▼                                                    ▼
 Los jugadores                                    Los clubes ven valor
 recomiendan la app                               en el tráfico de
 a sus rivales                                    jugadores nuevos
```

**Efectos secundarios valiosos:**

- **Para clubes**: MatchGo les trae clientes que vienen a jugar desafíos → más
  reservas de los slots valle que de otra forma están vacíos
- **Para patrocinadores**: "Llegá a los 284 jugadores activos de pádel en Salta
  esta semana" → publicidad segmentada
- **Para torneos**: cuando hay suficientes datos de rating, organizar un torneo
  con brackets balanceados es trivial
- **Para marcas de pádel**: datos de qué categorías son más activas, qué horarios,
  qué zonas de la ciudad

---

## 9. Roadmap de Construcción

### Fase 1 — Fundaciones (2-4 semanas)
Objetivo: primer APK real en Play Store (beta cerrada)

```
Sprint 1A — Cuenta del jugador
  [ ] Migraciones 0064-0065 (jugadores_app + links)
  [ ] Edge Function: registro/login del jugador
  [ ] Pantalla de onboarding (3 pasos: nombre, zona, vincular club)
  [ ] Tab "Mi Perfil" — datos básicos, sin historial aún

Sprint 1B — Reservas en la app
  [ ] Tab "Explorar" — lista de clubes con disponibilidad
  [ ] Flow de reserva desde la app (consume APIs del SaaS)
  [ ] Tab "Inicio" — próxima reserva
  [ ] Push: recordatorio 2h antes del turno
```

### Fase 2 — Desafíos reales (3-4 semanas)
Objetivo: primer círculo real funcionando (beta con un grupo de amigos)

```
Sprint 2A — Backend de desafíos
  [ ] Migraciones 0066-0071 (parejas, círculos, desafíos, partidos)
  [ ] RPCs: crear_desafio, aceptar_desafio, cargar_resultado, confirmar_resultado
  [ ] Edge Functions: notify-desafio, notify-resultado
  [ ] Cron: check-expiracion (diario)

Sprint 2B — UI de desafíos (conectar prototipo al backend)
  [ ] Conectar DesafiosPrototype a queries reales
  [ ] Flow de aceptar → elegir slot de reserva
  [ ] Cargar y confirmar resultado
  [ ] Push notifications live

Sprint 2C — Invitar pareja
  [ ] Solicitudes de pareja (0067)
  [ ] UI: buscar jugador, invitar, aceptar
  [ ] Push: solicitud_pareja, pareja_aceptada
```

### Fase 3 — Rating y Ranking (2-3 semanas)
Objetivo: ranking público de Salta en vivo

```
Sprint 3A — Sistema ELO
  [ ] Migración 0072 (ratings_historial)
  [ ] Edge Function: update-rating (se dispara al confirmar partido)
  [ ] Cálculo de categoría automática

Sprint 3B — Tab Ranking
  [ ] Ranking por categoría (top 100)
  [ ] Estadísticas de Salta (partidos, horas, clubes)
  [ ] Mapa de calor de horarios
  [ ] Mi posición fijada

Sprint 3C — Logros
  [ ] Migración 0073 (logros)
  [ ] Edge Function: check-logros
  [ ] Push: "¡Nuevo logro!"
  [ ] UI en perfil
```

### Fase 4 — Escala (ongoing)
```
  [ ] Play Store / App Store — publicación pública
  [ ] Incorporar más clubes al SaaS
  [ ] Múltiples círculos por jugador
  [ ] Torneo con brackets automáticos (usa el rating)
  [ ] Widget iOS/Android (próxima reserva)
  [ ] Share card para WhatsApp/Instagram (resultado del partido)
  [ ] Desafío abierto (sin escalera, solo amistoso registrado)
  [ ] Analytics para clubes: "Tu franja de 14:00 tuvo 12 desafíos este mes"
  [ ] Expansión a Jujuy, Tucumán
```

---

## Métricas de éxito

| Métrica | Mes 3 | Mes 6 | Mes 12 |
|---------|-------|-------|--------|
| Jugadores registrados | 50 | 200 | 500 |
| Partidos registrados | 100 | 800 | 3.000 |
| Clubes en el SaaS | 2 | 4 | 8 |
| Círculos activos | 2 | 8 | 20 |
| Push open rate | >25% | >30% | >35% |
| Retention D30 | >40% | >50% | >60% |

---

## Decisiones de arquitectura tomadas

| Decisión | Alternativas descartadas | Razón |
|---------|--------------------------|-------|
| Capacitor (una sola codebase) | React Native, Flutter | Reusa 90% del código Vite/React existente |
| ELO por pareja | ELO individual, rating manual | Estándar probado, transparente, auto-balanceante |
| Cuenta cross-club vía auth.uid | Club-per-club | El jugador es dueño de su dato, no el club |
| Confirmación doble del resultado | Admin confirma | Escalable, descentralizado, honesto |
| Desafíos: 4 días para aceptar | 7 días, 2 días | Balance entre urgencia y realidad laboral argentina |
| Rating mínimo 1200 | Sin piso | Evita que alguien deje de jugar por miedo a bajar |
| K=64 en calibración | K=32 desde el inicio | Llega rápido al rating real de cada jugador |

---

*Documento generado: 07 jun 2026*
*Versión: 1.0 — sujeto a revisión según feedback del mercado*
