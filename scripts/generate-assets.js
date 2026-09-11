import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const assetsDir = path.resolve('assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

// 1. Icon (1024x1024) - full icon with background
const iconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <rect width="1024" height="1024" fill="#0B1F4D"/>
  
  <g transform="translate(512, 512) scale(1.65) translate(-256, -256)">
    <!-- M estilizada -->
    <path
      d="M 90 400 L 155 120 L 256 225 L 357 120 L 422 400"
      fill="none"
      stroke="white"
      stroke-width="50"
      stroke-linecap="round"
      stroke-linejoin="round"
    />

    <!-- Pelota de pádel (lima) -->
    <circle cx="365" cy="130" r="70" fill="#D9F23B"/>

    <!-- Costura de la pelota -->
    <path
      d="M 342 108 Q 365 130 342 152"
      fill="none" stroke="#0B1F4D" stroke-width="6.5" stroke-linecap="round"
    />
    <path
      d="M 388 108 Q 365 130 388 152"
      fill="none" stroke="#0B1F4D" stroke-width="6.5" stroke-linecap="round"
    />

    <!-- Chevrons verdes -->
    <path d="M 102 305 L 122 321 L 102 337" fill="none" stroke="#39C54A" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/>
    <path d="M 122 305 L 144 321 L 122 337" fill="none" stroke="#39C54A" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" opacity="0.75"/>
    <path d="M 144 305 L 168 321 L 144 337" fill="none" stroke="#39C54A" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>
`;

// 2. Icon Foreground (1024x1024 transparent, within safe area)
const iconForegroundSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <g transform="translate(512, 512) scale(1.25) translate(-256, -256)">
    <!-- M estilizada -->
    <path
      d="M 90 400 L 155 120 L 256 225 L 357 120 L 422 400"
      fill="none"
      stroke="white"
      stroke-width="50"
      stroke-linecap="round"
      stroke-linejoin="round"
    />

    <!-- Pelota de pádel (lima) -->
    <circle cx="365" cy="130" r="70" fill="#D9F23B"/>

    <!-- Costura de la pelota -->
    <path
      d="M 342 108 Q 365 130 342 152"
      fill="none" stroke="#0B1F4D" stroke-width="6.5" stroke-linecap="round"
    />
    <path
      d="M 388 108 Q 365 130 388 152"
      fill="none" stroke="#0B1F4D" stroke-width="6.5" stroke-linecap="round"
    />

    <!-- Chevrons verdes -->
    <path d="M 102 305 L 122 321 L 102 337" fill="none" stroke="#39C54A" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/>
    <path d="M 122 305 L 144 321 L 122 337" fill="none" stroke="#39C54A" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" opacity="0.75"/>
    <path d="M 144 305 L 168 321 L 144 337" fill="none" stroke="#39C54A" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>
`;

// 3. Icon Background (1024x1024 solid color)
const iconBackgroundSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <rect width="1024" height="1024" fill="#0B1F4D"/>
</svg>
`;

// 4. Splash Screen (2732x2732)
const splashSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2732 2732" width="2732" height="2732">
  <rect width="2732" height="2732" fill="#0B1F4D"/>
  
  <!-- Isotipo centrado -->
  <g transform="translate(1366, 1260) scale(1.8) translate(0, -50)">
    <!-- M -->
    <path d="M-160 200 L-100 -120 L0 -10 L100 -120 L160 200"
      fill="none" stroke="white" stroke-width="52"
      stroke-linecap="round" stroke-linejoin="round"/>
    <!-- Ball -->
    <circle cx="108" cy="-110" r="72" fill="#D9F23B"/>
    <path d="M86 -132 Q108 -110 86 -88" fill="none" stroke="#0B1F4D" stroke-width="7" stroke-linecap="round"/>
    <path d="M130 -132 Q108 -110 130 -88" fill="none" stroke="#0B1F4D" stroke-width="7" stroke-linecap="round"/>
    <!-- Chevrones -->
    <path d="M-148 60 L-128 76 L-148 92" fill="none" stroke="#39C54A" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/>
    <path d="M-128 60 L-106 76 L-128 92" fill="none" stroke="#39C54A" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" opacity="0.75"/>
    <path d="M-106 60 L-82 76 L-106 92" fill="none" stroke="#39C54A" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  
  <!-- Wordmark -->
  <text x="1366" y="1700" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    font-size="140" font-weight="800" text-anchor="middle" fill="white" letter-spacing="1">MatchGo</text>
  <!-- Tagline -->
  <text x="1366" y="1790" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    font-size="44" font-weight="500" text-anchor="middle" fill="rgba(255,255,255,0.7)"
    letter-spacing="4">TU COMUNIDAD DE PÁDEL</text>
</svg>
`;

// 5. Standalone Splash Logo (1024x1024 transparent, 1:1 ratio)
const splashLogoSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <!-- Isotipo centrado -->
  <g transform="translate(512, 400) scale(1.15)">
    <!-- M estilizada -->
    <path d="M-160 200 L-100 -120 L0 -10 L100 -120 L160 200"
      fill="none" stroke="white" stroke-width="50"
      stroke-linecap="round" stroke-linejoin="round"/>
    <!-- Pelota de pádel (lima) -->
    <circle cx="108" cy="-110" r="70" fill="#D9F23B"/>
    <path d="M86 -132 Q108 -110 86 -88" fill="none" stroke="#0B1F4D" stroke-width="7" stroke-linecap="round"/>
    <path d="M130 -132 Q108 -110 130 -88" fill="none" stroke="#0B1F4D" stroke-width="7" stroke-linecap="round"/>
    <!-- Chevrones verdes -->
    <path d="M-148 60 L-128 76 L-148 92" fill="none" stroke="#39C54A" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/>
    <path d="M-128 60 L-106 76 L-128 92" fill="none" stroke="#39C54A" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" opacity="0.75"/>
    <path d="M-106 60 L-82 76 L-106 92" fill="none" stroke="#39C54A" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  
  <!-- Wordmark -->
  <text x="512" y="755" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    font-size="120" font-weight="900" text-anchor="middle" fill="white" letter-spacing="1">MatchGo</text>
  <!-- Tagline -->
  <text x="512" y="830" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    font-size="34" font-weight="600" text-anchor="middle" fill="rgba(255,255,255,0.75)"
    letter-spacing="5">TU COMUNIDAD DE PÁDEL</text>
</svg>
`;

// 6. Notification Small Icon (96x96 transparent monochrome)
const notifIconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96">
  <g transform="translate(48, 48) scale(0.18)">
    <path d="M-160 200 L-100 -120 L0 -10 L100 -120 L160 200"
      fill="none" stroke="white" stroke-width="50"
      stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="108" cy="-110" r="65" fill="white"/>
  </g>
</svg>
`;

async function generate() {
  console.log('Generando imágenes maestras en /assets...');

  await sharp(Buffer.from(iconSvg)).png().toFile(path.join(assetsDir, 'icon-only.png'));
  await sharp(Buffer.from(iconSvg)).png().toFile(path.join(assetsDir, 'icon.png'));
  await sharp(Buffer.from(iconForegroundSvg)).png().toFile(path.join(assetsDir, 'icon-foreground.png'));
  await sharp(Buffer.from(iconBackgroundSvg)).png().toFile(path.join(assetsDir, 'icon-background.png'));
  await sharp(Buffer.from(splashSvg)).png().toFile(path.join(assetsDir, 'splash.png'));
  await sharp(Buffer.from(splashSvg)).png().toFile(path.join(assetsDir, 'splash-dark.png'));

  // Splash Logo standalone 1:1
  const splashLogoBuffer = await sharp(Buffer.from(splashLogoSvg)).png().toBuffer();
  fs.writeFileSync(path.join(assetsDir, 'matchgo_splash_logo.png'), splashLogoBuffer);
  fs.writeFileSync(path.resolve('public/assets/matchgo_splash_logo.png'), splashLogoBuffer);
  
  const androidDrawableDir = path.resolve('android/app/src/main/res/drawable');
  if (!fs.existsSync(androidDrawableDir)) fs.mkdirSync(androidDrawableDir, { recursive: true });
  fs.writeFileSync(path.join(androidDrawableDir, 'matchgo_splash_logo.png'), splashLogoBuffer);

  // Notification status bar icon
  const notifBuffer = await sharp(Buffer.from(notifIconSvg)).png().toBuffer();
  const resDirs = [
    'android/app/src/main/res/drawable',
    'android/app/src/main/res/drawable-hdpi',
    'android/app/src/main/res/drawable-mdpi',
    'android/app/src/main/res/drawable-xhdpi',
    'android/app/src/main/res/drawable-xxhdpi',
    'android/app/src/main/res/drawable-xxxhdpi',
  ];

  resDirs.forEach(dir => {
    const fullDir = path.resolve(dir);
    if (!fs.existsSync(fullDir)) fs.mkdirSync(fullDir, { recursive: true });
    fs.writeFileSync(path.join(fullDir, 'ic_stat_matchgo.png'), notifBuffer);
  });

  console.log('Imágenes maestras creadas con éxito.');
  console.log('Ejecutando @capacitor/assets generate --android...');
  execSync('npx @capacitor/assets generate --android', { stdio: 'inherit' });
  console.log('¡Recursos de Android generados exitosamente!');
}

generate().catch(console.error);
