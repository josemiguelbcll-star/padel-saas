# 🧪 TEST PLAN — MatchGo Player App

**URL:** https://matchogo.vercel.app/player  
**Test User 1:** `test@padel.com` / `TestPadel123!`

---

## 📋 TEST CASES

### 1️⃣ **Autenticación & Onboarding**
- [ ] Login con credenciales válidas → redirige a Inicio
- [ ] Mensaje de error con credenciales inválidas
- [ ] Onboarding Step 1: ingresar nombre y teléfono válido (Ej: 3874211234)
- [ ] Validación: teléfono inválido muestra error
- [ ] Onboarding Step 2: muestra confirmación con nombre
- [ ] Botón "Empezar a reservar" → entra a la app
- [ ] Datos persisten después de refresh

---

### 2️⃣ **Tab INICIO (Feed Central)**
- [ ] Saludo personalizado con nombre del usuario
- [ ] Sección "Próxima reserva": aparece si hay reserva futura
- [ ] Sección "Feed central":
  - [ ] Muestra posts de clubes (si existen)
  - [ ] Muestra turnos abiertos de esta semana
  - [ ] Posts muestran: tipo, título, contenido, club
  - [ ] Turnos muestran: club, cancha, fecha, hora, cantidad jugadores libres, precio
- [ ] "Sin próximas reservas" si no hay turnos

---

### 3️⃣ **Tab RESERVAR (Explorar)**
- [ ] Ver lista de clubes
- [ ] Seleccionar un club → ClubProfilePage
- [ ] Elegir fecha (próximos 7 días)
- [ ] Elegir horario → ver canchas disponibles
- [ ] Seleccionar cancha + duración
- [ ] Botón "Reservar →" abre bottom sheet
- [ ] Bottom sheet muestra:
  - [ ] Detalles (club, cancha, fecha, hora, duración)
  - [ ] Botón "Reservar ahora →"
  - [ ] Paso 2: muestra monto total, seña (50%), CBU/alias, instrucciones
- [ ] ✓ "Reserva confirmada" → navega a "Mis canchas"

---

### 4️⃣ **Tab MIS CANCHAS (Partidos)**
- [ ] Sección "Próximas reservas":
  - [ ] Lista reservas futuras
  - [ ] Muestra: fecha, club, cancha, hora, estado
- [ ] Sección "Historial":
  - [ ] Últimas 10 reservas pasadas
  - [ ] Muestra club, cancha, fecha, hora
- [ ] Badges de estado: Pendiente (gris), Pagada (verde), Jugada (verde)

---

### 5️⃣ **Tab PERFIL**

#### A. Datos Personales
- [ ] Muestra avatar con iniciales
- [ ] Muestra nombre, categoría, teléfono
- [ ] Botón "Editar perfil" abre editor
- [ ] Cambiar datos → "Guardar cambios" → vuelve a perfil

#### B. Próximas Reservas
- [ ] Same as "Mis canchas" tab

#### C. Comunidad → Amigos
- [ ] Botón "Agregar amigo"
- [ ] Modal de búsqueda:
  - [ ] Digitar nombre → busca jugadores
  - [ ] Muestra resultados con avatar + nombre
  - [ ] Botón "Agregar" → agrega como pendiente
- [ ] Sección "Solicitudes pendientes":
  - [ ] Muestra amigos que se agregaron (confirmado=false)
- [ ] Sección "Mis amigos":
  - [ ] Muestra amigos confirmados (confirmado=true)
  - [ ] Botón "Desafiar" (próximo test)
  - [ ] Si vacío: mensaje "Aún no tienes amigos"

#### D. Desafios
- [ ] Sección "Desafios pendientes 🎯":
  - [ ] Muestra desafios que RECIBÍ
  - [ ] Botones "Aceptar" / "Rechazar"
  - [ ] Al clickear "Aceptar" → confirma detalles
  - [ ] ✓ "Aceptar" → crea 2 reservas automáticas
  - [ ] "Rechazar" → marca como rechazado
- [ ] Sección "Confirmados ✓":
  - [ ] Muestra desafios aceptados
  - [ ] Mensaje "Reservas creadas automáticamente"
- [ ] Sección "Historial":
  - [ ] Muestra rechazados, jugados, propuestos

#### E. Panel Admin (solo si eres admin)
- [ ] Aparece sección "👨‍💼 PANEL ADMIN" si eres admin de un club
- [ ] **Tab Posts 📰**:
  - [ ] Seleccionar tipo (noticia/promo/torneo)
  - [ ] Ingresar título + contenido
  - [ ] Ingresar imagen URL (opcional)
  - [ ] Botón "+ Publicar"
  - [ ] ✓ Éxito → "Post creado"
  - [ ] Post aparece en feed en tiempo real
- [ ] **Tab Promociones 🎉**:
  - [ ] Elegir tipo (descuento tarifa / 2x1 producto)
  - [ ] Si descuento tarifa:
    - [ ] Seleccionar tarifa
    - [ ] Ingresar % descuento (1-99)
    - [ ] Botón "+ Crear promoción"
  - [ ] Si 2x1 producto:
    - [ ] Seleccionar producto
    - [ ] Botón "+ Crear promoción"
  - [ ] ✓ Éxito → "Promoción creada"

---

## 🧪 **FLUJO COMPLETO (End-to-End)**

### Escenario: Dos jugadores se desafían

**Paso 1: Crear 2 usuarios**
```
Usuario A: test@padel.com / TestPadel123!
Usuario B: (crear nuevo si es necesario)
```

**Paso 2: Agregar como amigos (ambos lados)**
- Usuario A entra a Perfil → Amigos → Agregar → busca Usuario B → Agregar
- Usuario B entra a Perfil → Amigos → Agregar → busca Usuario A → Agregar

**Paso 3: Usuario A desafia a Usuario B** (si hay botón de desafio)
- (Nota: el botón de desafio no está en AmigosPanel aún, será para Sprint 5)

**Paso 4 (Alternativo): Usuario A crea post en feed**
- Si Usuario A es admin:
  - Perfil → Admin Panel → Posts
  - Tipo: "Promo"
  - Título: "Vengan a jugar mañana"
  - Contenido: "Oferta especial de 50% OFF"
  - Publicar
  - Verificar que aparezca en feed de todos

**Paso 5: Usuario A se reserva una cancha**
- Reservar → seleccionar club → fecha → horario → cancha → duración
- Bottom sheet: confirmar detalles
- Aceptar
- Verificar en "Mis canchas" que aparezca la reserva

**Paso 6: Ver mis reservas**
- Pestaña "Mis canchas": debe aparecer la reserva nueva
- Estado debe ser "Pendiente" (gris)

---

## ✅ **Criterios de Aceptación**

- [ ] **Auth**: Login, onboarding, persistencia
- [ ] **Feed**: Posts visibles, turnos abiertos correctos
- [ ] **Amigos**: Búsqueda, agregar, listar
- [ ] **Desafios**: Crear, aceptar, rechazar, reservas automáticas
- [ ] **Reservas**: Crear desde app, seña correcta, datos en "Mis canchas"
- [ ] **Admin**: Posts y promos se crean y aparecen en feed
- [ ] **UI**: Sin errores console, estilos correctos, responsive

---

## 🐛 **Reporte de Bugs**

Si encuentras algún problema, documenta:
1. **Pasos para reproducir**
2. **Resultado esperado**
3. **Resultado actual**
4. **Screenshots/videos** (si aplica)

---

**¡Buen testing! 🚀**
