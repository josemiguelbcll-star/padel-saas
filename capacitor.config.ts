import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Configuración de Capacitor para MatchGo.
 *
 * App ID:    ar.matchgo.app   (reverse domain — debe coincidir con
 *            el Bundle ID en App Store y el Application ID en Google Play)
 * webDir:    dist             (salida de `npm run build` / Vite)
 *
 * ARQUITECTURA DE USUARIOS:
 * - Jugadores (B2C):  rutas públicas /  /club/:slug  /prototipo/desafios
 *   → Destino principal de la app móvil
 * - Admins (B2B):     rutas bajo /app  (funcionan también dentro de la app)
 *   → Siguen usando el panel web; la app es para jugadores
 *
 * BUILDS:
 * 1. npm run build      → genera dist/
 * 2. npx cap sync       → copia dist/ + plugins a android/ e ios/
 * 3. npx cap open android  → abre Android Studio para generar APK/AAB
 * 4. npx cap open ios      → abre Xcode para generar IPA (requiere Mac)
 */
const config: CapacitorConfig = {
  appId: 'ar.matchgo.app',
  appName: 'MatchGo',
  webDir: 'dist',

  // Servidor de desarrollo: cuando hacés `npx cap run android` en dev,
  // apunta al Vite dev server en lugar de servir dist/ estático.
  // Comentar para builds de producción.
  // server: {
  //   url: 'http://192.168.x.x:5173',   // ← tu IP local
  //   cleartext: true,
  // },

  plugins: {
    // ── Push Notifications ────────────────────────────────────────────────
    // Android: usa Firebase Cloud Messaging (FCM).
    // iOS:     usa APNs + entitlements en Xcode.
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },

    // ── Status Bar ────────────────────────────────────────────────────────
    // Fondo marino (#0B1F4D) para que se vea integrada con el top bar
    // de la app de jugadores (color MatchGo).
    StatusBar: {
      style: 'DARK',            // texto blanco sobre fondo oscuro
      backgroundColor: '#0B1F4D',
      overlaysWebView: false,
    },

    // ── Splash Screen ─────────────────────────────────────────────────────
    // Usar @capacitor/assets para generar los íconos y splash
    // a partir de assets/icon.png (1024×1024) y assets/splash.png (2732×2732).
    // Comando: npx @capacitor/assets generate
    SplashScreen: {
      launchShowDuration: 1800,
      launchAutoHide: true,
      backgroundColor: '#0B1F4D',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
  },

  android: {
    // minSdkVersion: 22 = Android 5.1+ (cubre >99% de dispositivos activos AR)
    minSdkVersion: 22,
    // Permite tráfico HTTP en debug (quitar en prod o usar HTTPS)
    allowMixedContent: false,
    // Color de la barra de navegación inferior
    navigationBarColor: '#0B1F4D',
    backgroundColor: '#FFFFFF',
  },

  ios: {
    // contentInset: 'automatic' para que el contenido respete
    // el notch y las safe areas de iPhone.
    contentInset: 'automatic',
    backgroundColor: '#FFFFFF',
    // Permite WebRTC y otras APIs modernas
    allowsLinkPreview: false,
  },
};

export default config;
