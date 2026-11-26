// Browser e2e (Playwright chromium from .tools/pw). Run via run-browser.sh which seeds, builds-less starts `next start` on a spare port.
import { chromium } from '/home/chimera/cynchor_com_orginal/.tools/pw/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const B = process.env.B || 'http://127.0.0.1:3458';
const OUT = new URL('.', import.meta.url).pathname;
const results = []; const consoleErrors = [];
const ok = (name, cond, extra = '') => { results.push({ name, pass: !!cond, extra }); console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
const H = { 'Content-Type': 'application/json', Origin: B };
async function user(id) {
  const ctx = await browser.newContext({ baseURL: B });
  const r = await ctx.request.post('/api/auth/login', { headers: H, data: { email: `e2e_${id}@e2e.example.test`, password: 'E2e-Passw0rd!' } });
  if (!r.ok()) throw new Error('login ' + id + ' ' + r.status());
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${id}: ${m.text()}`); });
  page.on('pageerror', (e) => consoleErrors.push(`${id} pageerror: ${e.message}`));
  return { id, ctx, page };
}
try {
  const [red1, red2, blue1, blue2, spec] = await Promise.all(['red1', 'red2', 'blue1', 'blue2', 'spec'].map(user));
  // Lobby
  await blue1.page.goto('/range/lobby');
  await blue1.page.getByRole('button', { name: /Queue as BLUE/ }).waitFor({ timeout: 15000 });
  ok('lobby renders for blue', true);
  await blue1.page.screenshot({ path: OUT + 'lobby-blue.png' });
  await blue1.page.getByRole('button', { name: /Queue as BLUE/ }).click();
  await blue1.page.getByText(/Searching for an opposing squad/).waitFor({ timeout: 10000 });
  ok('blue queued, lobby shows searching', true);
  await red1.page.goto('/range/lobby');
  await red1.page.getByRole('button', { name: /Queue as RED/ }).click();
  await red1.page.waitForURL(/\/range\/match\//, { timeout: 30000 });
  const matchId = red1.page.url().split('/range/match/')[1].split(/[/?#]/)[0];
  ok('red redirected to match page', !!matchId, matchId);
  await blue1.page.waitForURL(/\/range\/match\//, { timeout: 15000 });
  ok('blue lobby polling redirected to match page', true);
  await red2.page.goto(`/range/match/${matchId}`); await blue2.page.goto(`/range/match/${matchId}`);
  await spec.page.goto(`/range/spectate/${matchId}`);
  for (const u of [red1, blue1, spec]) await u.page.getByText('STREAM CONNECTED').waitFor({ timeout: 15000 });
  ok('SSE stream connected on red/blue/spectator', true);
  ok('red side marker', (await red1.page.getByTestId('side').textContent()) === 'RED');
  ok('blue side marker', (await blue1.page.getByTestId('side').textContent()) === 'BLUE');
  ok('VaultMeter renders', await red1.page.getByText(/vault/i).first().isVisible());
  await red1.page.getByLabel('Attack console').waitFor();
  ok('red sees AttackConsole only', (await red1.page.getByLabel('Patch console').count()) === 0);
  ok('blue sees PatchConsole only', (await blue1.page.getByLabel('Patch console').count()) === 1 && (await blue1.page.getByLabel('Attack console').count()) === 0);
  // AttackConsole request
  await red1.page.getByRole('button', { name: 'Send request' }).click();
  await red1.page.waitForFunction(() => /HTTP \d+/.test(document.querySelector('[data-testid=attack-response]')?.textContent || ''), null, { timeout: 15000 });
  ok('AttackConsole /healthz returns response', true, (await red1.page.getByTestId('attack-response').textContent()).slice(0, 60).replace(/\n/g, ' '));
  await red1.page.getByLabel('Path').fill('/internal/admin/accounts');
  await red1.page.getByRole('button', { name: 'Send request' }).click();
  await red1.page.waitForFunction(() => /HTTP 200/.test(document.querySelector('[data-testid=attack-response]')?.textContent || ''), null, { timeout: 15000 });
  ok('AttackConsole exploit request lands', true);
  // RangeFeed SSE events
  await red1.page.waitForFunction(() => /PROXY_REQUEST|EXPLOIT_LANDED/.test(document.querySelector('[data-testid=range-feed]')?.textContent || ''), null, { timeout: 20000 });
  ok('RangeFeed received SSE events (red)', true);
  await sleep(7000);
  // PatchConsole submit (no-op patch of current content must be accepted or return a visible result)
  await blue1.page.getByRole('button', { name: 'Apply patch' }).click();
  await blue1.page.getByTestId('patch-result').waitFor({ timeout: 30000 });
  ok('PatchConsole submit shows result', true, (await blue1.page.getByTestId('patch-result').textContent()).slice(0, 80));
  // Spectator hides RED-only / BLUE-only events
  await sleep(3000);
  const specFeed = await spec.page.getByTestId('range-feed').textContent();
  const redFeed = await red1.page.getByTestId('range-feed').textContent();
  const blueFeed = await blue1.page.getByTestId('range-feed').textContent();
  ok('red feed has no PATCH_APPLIED (blue-only)', !/PATCH_APPLIED/.test(redFeed));
  ok('spectator feed has no PROXY_REQUEST/PATCH_APPLIED (side-only)', !/PROXY_REQUEST|PATCH_APPLIED/.test(specFeed), specFeed.slice(0, 120));
  ok('blue feed has no PROXY_REQUEST (red-only)', !/PROXY_REQUEST/.test(blueFeed));
  await spec.page.screenshot({ path: OUT + 'spectator.png' });
  await red1.page.screenshot({ path: OUT + 'match-red.png' });
  await blue1.page.screenshot({ path: OUT + 'match-blue.png' });
  // finish match: boss sweep via API
  for (let i = 0; i < 40; i++) {
    const r = await red2.ctx.request.post(`/api/range/${matchId}/proxy`, { headers: H, data: { method: 'POST', path: '/internal/admin/vault', body: { toId: 3 } } });
    const rr = await spec.ctx.request.get(`/api/range/${matchId}/report`);
    if (rr.status() === 200) break;
    await sleep(1500);
  }
  await red1.page.getByText('MATCH ENDED').waitFor({ timeout: 40000 });
  ok('match ended banner + After Action Report link', await red1.page.getByRole('link', { name: /After Action Report/ }).isVisible());
  await red1.page.getByRole('link', { name: /After Action Report/ }).click();
  await red1.page.waitForURL(/report/);
  await red1.page.waitForLoadState('networkidle');
  const reportHtml = await red1.page.content();
  ok('report page renders', /report/i.test(await red1.page.title() + await red1.page.textContent('body')));
  ok('report has no emails', !/e2e\.example\.test|@/.test(await red1.page.textContent('body')));
  await red1.page.screenshot({ path: OUT + 'report.png' });
  // leaderboard filters
  await spec.page.goto('/range/leaderboard');
  await spec.page.getByTestId('room-filter').waitFor({ timeout: 15000 });
  const rooms = await spec.page.getByTestId('room-filter').locator('option').count();
  ok('leaderboard room filter has options', rooms >= 2, `${rooms}`);
  await spec.page.getByTestId('room-filter').selectOption({ index: 1 });
  await spec.page.waitForLoadState('networkidle');
  ok('room filter select works', await spec.page.getByTestId('team-board').isVisible());
  const levels = await spec.page.getByTestId('level-filter').locator('option').count();
  ok('leaderboard level filter has options', levels >= 2, `${levels}`);
  await spec.page.getByTestId('level-filter').selectOption({ index: 1 });
  await spec.page.waitForLoadState('networkidle');
  ok('level filter select works', await spec.page.getByTestId('player-board').isVisible());
  ok('leaderboard has no emails', !/@/.test(await spec.page.textContent('body')));
  await spec.page.screenshot({ path: OUT + 'leaderboard.png' });
  // SSE cleanup: navigate away from the match page, count open event requests server-side not available; check no console errors
  await red1.page.goto('/range/lobby'); await sleep(500);
} catch (e) {
  ok('script completed without exception', false, String(e).slice(0, 400));
}
ok('no browser console errors', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));
fs.writeFileSync(OUT + 'browser-results.json', JSON.stringify({ results, consoleErrors }, null, 2));
await browser.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
