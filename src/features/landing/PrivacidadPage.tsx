import { Link } from 'react-router-dom';

/**
 * Política de privacidad pública — requerida por la verificación de
 * Google Cloud / OAuth. Contenido alineado con lo que la app realmente
 * recopila: cuenta y perfil, reservas y turnos, datos de pago
 * (procesados por pasarelas externas), ubicación aproximada para
 * buscar clubes, notificaciones push y login con Google.
 */
export function PrivacidadPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Link to="/" className="text-sm font-semibold text-primary">
          ← Volver al inicio
        </Link>

        <h1 className="mt-6 text-3xl font-bold tracking-tight">
          Política de Privacidad
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Última actualización: 25 de noviembre de 2026
        </p>

        <div className="mt-8 space-y-6 text-sm leading-relaxed text-muted-foreground">
          <section>
            <h2 className="text-base font-semibold text-foreground">
              1. Responsable del tratamiento
            </h2>
            <p className="mt-2">
              MatchGo es una plataforma de gestión para clubes de pádel.
              El responsable del tratamiento de los datos personales es el
              titular de la plataforma, y cada club que utiliza el servicio
              trata los datos de sus jugadores y staff en el marco de su
              propia relación con ellos. Para consultas sobre privacidad
              podés escribirnos a través de los canales de contacto
              publicados en la plataforma.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground">
              2. Datos que recopilamos
            </h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <strong className="text-foreground">Datos de cuenta:</strong>{' '}
                nombre, correo electrónico y contraseña (almacenada de forma
                cifrada) al registrarte. Si iniciás sesión con Google,
                recibimos tu nombre, correo y foto de perfil de Google para
                crear o vincular tu cuenta.
              </li>
              <li>
                <strong className="text-foreground">Datos de reservas y
                turnos:</strong> nombre del jugador, horarios, canchas,
                duraciones, señas y pagos asociados a las reservas.
              </li>
              <li>
                <strong className="text-foreground">Datos de consumo y
                ventas:</strong> productos consumidos en el club, montos y
                medios de pago utilizados (los datos de tarjetas o cuentas
                bancarias los procesa la pasarela de pago correspondiente,
                no se almacenan en nuestra base de datos).
              </li>
              <li>
                <strong className="text-foreground">Datos de clases:</strong>{' '}
                inscripciones a clases, asistencias y pagos de cuota.
              </li>
              <li>
                <strong className="text-foreground">Datos de ubicación
                aproximada:</strong> cuando buscás clubes en la pantalla de
                inicio, la app puede usar tu ubicación o la dirección que
                ingresás para mostrar resultados cercanos. El texto de la
                búsqueda puede enviarse al servicio de geocodificación
                OpenStreetMap/Nominatim.
              </li>
              <li>
                <strong className="text-foreground">Notificaciones push:</strong>{' '}
                si activás las notificaciones, recibimos un identificador
                de dispositivo para enviarte avisos de reservas, clases y
                novedades del club.
              </li>
              <li>
                <strong className="text-foreground">Datos técnicos:</strong>{' '}
                registros de errores y diagnóstico (Sentry) para mantener la
                estabilidad del servicio, que pueden incluir datos de la
                sesión y del dispositivo de forma anonimizada.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground">
              3. Para qué usamos los datos
            </h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Gestionar reservas, turnos, clases y pagos.</li>
              <li>
                Operar la caja y la facturación de cada club.
              </li>
              <li>
                Enviarte notificaciones y comunicaciones del servicio o del
                club que uses.
              </li>
              <li>Mostrarte clubes y disponibilidad cercana a tu zona.</li>
              <li>
                Prevenir fraudes, asegurar la plataforma y cumplir
                obligaciones fiscales y contables de cada club.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground">
              4. Con quién compartimos datos
            </h2>
            <p className="mt-2">
              No vendemos datos personales. Compartimos la información
              estrictamente necesaria con proveedores de infraestructura y
              servicios que tratan datos por nuestra cuenta: Supabase
              (base de datos y autenticación), servicios de geocodificación
              (OpenStreetMap/Nominatim), pasarelas de pago cuando el club o
              el jugador elige pagar por ese medio, y Sentry para
              monitoreo de errores. Cada club también accede a los datos de
              sus propios jugadores y operaciones como parte de la gestión
              del club.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground">
              5. Conservación y seguridad
            </h2>
            <p className="mt-2">
              Conservamos los datos mientras la cuenta esté activa y durante
              los plazos que exijan las obligaciones contables y fiscales
              aplicables. Aplicamos cifrado en tránsito, políticas de acceso
              por club (cada club solo ve sus datos) y controles de
              seguridad estándar de la industria.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground">
              6. Tus derechos
            </h2>
            <p className="mt-2">
              Podés solicitar acceso, rectificación, actualización o
              eliminación de tus datos personales, así como oponerte a
              ciertos tratamientos, escribiendo al canal de contacto
              publicado. Tené en cuenta que algunos datos deben conservarse
              por obligaciones legales del club (por ejemplo, registros de
              pagos).
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground">
              7. Cookies y almacenamiento local
            </h2>
            <p className="mt-2">
              La app utiliza almacenamiento local del navegador/dispositivo
              para mantener tu sesión iniciada y preferencias. No usamos
              cookies de publicidad ni rastreo de terceros para fines
              comerciales.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground">
              8. Cambios en esta política
            </h2>
            <p className="mt-2">
              Podemos actualizar esta política; la versión vigente será la
              publicada en esta página con su fecha de actualización.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
