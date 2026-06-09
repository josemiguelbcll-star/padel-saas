import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const BASE = 'https://matchogo.vercel.app/player';
const OUT  = 'C:/proyectos/padel-saas/screenshots';
mkdirSync(OUT, { recursive: true });

// iPhone 14 Pro dimensions
const VIEWPORT = { width: 390, height: 844 };

async function shot(page, name) {
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`✓ ${name}`);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();

// ── 1. Login ──────────────────────────────────────────────────────────────
await page.goto(BASE, { waitUntil: 'networkidle' });
await shot(page, '01-login');

// ── 2. Onboarding Step 1 ──────────────────────────────────────────────────
// Log in with any credentials
await page.fill('input[type="email"], input[placeholder*="mail"], input[placeholder*="Email"]', 'test@matchgo.com').catch(() => {});
await page.fill('input[type="password"], input[placeholder*="senha"], input[placeholder*="Contraseña"]', '123456').catch(() => {});
// Try clicking any login button
const loginBtn = page.locator('button').filter({ hasText: /entrar|login|ingresar|continuar/i }).first();
await loginBtn.click().catch(() => {});
await page.waitForTimeout(1200);
await shot(page, '02-onboarding-paso1');

// ── 3. Onboarding Step 1 filled ───────────────────────────────────────────
await page.fill('input[type="text"], input[placeholder*="José"], input[placeholder*="nombre"]', 'José Miguel').catch(() => {});
await page.fill('input[type="tel"], input[placeholder*="54"]', '+54 387 412 3456').catch(() => {});
await page.waitForTimeout(500);
await shot(page, '03-onboarding-paso1-lleno');

// ── 4. Onboarding Step 2 ──────────────────────────────────────────────────
const contBtn = page.locator('button').filter({ hasText: /continuar|siguiente/i }).first();
await contBtn.click().catch(() => {});
await page.waitForTimeout(800);
await shot(page, '04-onboarding-paso2-bienvenida');

// ── 5. Entrar a la app ────────────────────────────────────────────────────
const startBtn = page.locator('button').filter({ hasText: /empezar|jugar|reservar/i }).first();
await startBtn.click().catch(() => {});
await page.waitForTimeout(1000);
await shot(page, '05-home');

// ── 6. Tab Reservar ───────────────────────────────────────────────────────
const reservarTab = page.locator('button').filter({ hasText: /reservar/i }).first();
await reservarTab.click().catch(() => {});
await page.waitForTimeout(1200);
await shot(page, '06-reservar-clubes');

// ── 7. Perfil de club ─────────────────────────────────────────────────────
const clubCard = page.locator('button').filter({ hasText: /ver turnos/i }).first();
await clubCard.click().catch(() => {});
await page.waitForTimeout(1500);
await shot(page, '07-club-detalle');

// Scroll down to see availability
await page.mouse.wheel(0, 400);
await page.waitForTimeout(600);
await shot(page, '08-club-disponibilidad');

// Volver
await page.locator('button').filter({ hasText: /volver/i }).first().click().catch(() => {});
await page.waitForTimeout(600);

// ── 8. Tab Jugar ──────────────────────────────────────────────────────────
const jugarTab = page.locator('button').filter({ hasText: /jugar/i }).first();
await jugarTab.click().catch(() => {});
await page.waitForTimeout(800);
await shot(page, '09-jugar');

// ── 9. Tab Partidos ───────────────────────────────────────────────────────
const partidosTab = page.locator('button').filter({ hasText: /partidos/i }).first();
await partidosTab.click().catch(() => {});
await page.waitForTimeout(800);
await shot(page, '10-partidos');

// ── 10. Tab Perfil ────────────────────────────────────────────────────────
const perfilTab = page.locator('button').filter({ hasText: /perfil/i }).first();
await perfilTab.click().catch(() => {});
await page.waitForTimeout(800);
await shot(page, '11-perfil-top');

// Scroll down perfil
await page.mouse.wheel(0, 500);
await page.waitForTimeout(500);
await shot(page, '12-perfil-bottom');

await browser.close();
console.log('\nTodas las capturas guardadas en:', OUT);
