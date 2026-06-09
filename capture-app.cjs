const { chromium } = require('C:/Users/JOSE MIGUEL BC/AppData/Local/Temp/node_modules/playwright');
const { mkdirSync } = require('fs');
const path = require('path');

const BASE = 'https://matchogo.vercel.app/player';
const OUT  = 'C:/proyectos/padel-saas/screenshots';
mkdirSync(OUT, { recursive: true });

const VIEWPORT = { width: 390, height: 844 };

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();

  async function shot(name) {
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: false });
    console.log('✓', name);
  }

  // ── 1. Login ──────────────────────────────────────────────────────────────
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await shot('01-login');

  // ── 2. Fill login form and submit ────────────────────────────────────────
  try {
    const emailInput = page.locator('input[type="email"]').first();
    await emailInput.fill('test@matchgo.com');
    const passInput = page.locator('input[type="password"]').first();
    await passInput.fill('123456');
    // Click the primary login button
    await page.locator('button[type="submit"], button').filter({ hasText: /entrar|ingresar|iniciar|continuar/i }).first().click();
    await page.waitForTimeout(1000);
  } catch(e) { console.log('login form err:', e.message); }
  await shot('02-onboarding-step1');

  // ── 3. Fill onboarding step 1 ────────────────────────────────────────────
  try {
    await page.locator('input[type="text"]').first().fill('José Miguel');
    await page.locator('input[type="tel"]').first().fill('+54 387 412 3456');
    await page.waitForTimeout(400);
  } catch(e) {}
  await shot('03-onboarding-step1-filled');

  // ── 4. Go to step 2 ───────────────────────────────────────────────────────
  try {
    await page.locator('button').filter({ hasText: /continuar/i }).first().click();
    await page.waitForTimeout(800);
  } catch(e) {}
  await shot('04-onboarding-step2-welcome');

  // ── 5. Enter app ──────────────────────────────────────────────────────────
  try {
    await page.locator('button').filter({ hasText: /empezar/i }).first().click();
    await page.waitForTimeout(1000);
  } catch(e) {}
  await shot('05-home');

  // ── 6. Tab Reservar ───────────────────────────────────────────────────────
  try {
    // Bottom nav: find Reservar tab
    const allBtns = page.locator('nav button, .mgp-bottomnav button');
    const count = await allBtns.count();
    console.log('nav buttons:', count);
    // Click second button (Reservar)
    if (count >= 2) await allBtns.nth(1).click();
    await page.waitForTimeout(1200);
  } catch(e) { console.log('reservar err:', e.message); }
  await shot('06-reservar-explorar');

  // ── 7. Click first club ───────────────────────────────────────────────────
  try {
    await page.locator('button').filter({ hasText: /ver turnos/i }).first().click();
    await page.waitForTimeout(1500);
  } catch(e) {}
  await shot('07-club-detalle-top');

  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(600);
  await shot('08-club-disponibilidad');

  // Volver
  try {
    await page.locator('button').filter({ hasText: /volver/i }).first().click();
    await page.waitForTimeout(600);
  } catch(e) {}

  // ── 8. Tab Jugar ─────────────────────────────────────────────────────────
  try {
    const allBtns = page.locator('nav button, .mgp-bottomnav button');
    const count = await allBtns.count();
    if (count >= 3) await allBtns.nth(2).click();
    await page.waitForTimeout(800);
  } catch(e) {}
  await shot('09-jugar');

  // ── 9. Tab Partidos ───────────────────────────────────────────────────────
  try {
    const allBtns = page.locator('nav button, .mgp-bottomnav button');
    const count = await allBtns.count();
    if (count >= 4) await allBtns.nth(3).click();
    await page.waitForTimeout(800);
  } catch(e) {}
  await shot('10-partidos');

  // ── 10. Tab Perfil ────────────────────────────────────────────────────────
  try {
    const allBtns = page.locator('nav button, .mgp-bottomnav button');
    const count = await allBtns.count();
    if (count >= 5) await allBtns.nth(4).click();
    await page.waitForTimeout(900);
  } catch(e) {}
  await shot('11-perfil-top');

  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(500);
  await shot('12-perfil-bottom');

  await browser.close();
  console.log('\n✅ Capturas guardadas en:', OUT);
}

main().catch(console.error);
