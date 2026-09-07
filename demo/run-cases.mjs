#!/usr/bin/env node
/*!
 * Run demo/cases.html in a real headless Chromium and print the self-check results.
 *
 *   node demo/run-cases.mjs                    # exit 0 = all green, 1 = a case failed, 2 = could not run
 *   node demo/run-cases.mjs --browser /path/to/chrome
 *   node demo/run-cases.mjs --page file:///…/cases.html
 *
 * Why a CDP driver and not `chrome --dump-dom --virtual-time-budget=…`:
 * virtual time fast-forwards timers but does not promise frames, and two of the cases wait on
 * things that only happen in a frame — the materialize ramp (requestAnimationFrame) and the settle
 * fallback (ResizeObserver). Under virtual time those two report false failures. So: real time,
 * and wait for the page to raise its own flag.
 *
 * No dependencies: Node's global WebSocket (Node 22+) and node:http over loopback.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i > -1 ? process.argv[i + 1] : dflt; };
const KEEP = process.argv.includes('--keep');

if (typeof WebSocket === 'undefined') {
  console.error('needs Node 22+ (this script uses the built-in WebSocket). Running: ' + process.version);
  process.exit(2);
}

const CANDIDATES = [
  process.env.HYALITE_CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
].filter(Boolean);

const BROWSER = arg('browser') || CANDIDATES.find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } });
if (!BROWSER) {
  console.error('no Chromium-based browser found. Pass --browser <path> or set HYALITE_CHROME.\ntried:\n  ' + CANDIDATES.join('\n  '));
  process.exit(2);
}
const PAGE = arg('page') || 'file://' + path.join(HERE, 'cases.html');

/* An ephemeral port the OS just handed back, so parallel runs do not collide. */
const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* Loopback only, and deliberately no Host header: Chrome rewrites webSocketDebuggerUrl from it,
   and a Host of "localhost" comes back without the port. */
const getJSON = (port, p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port, path: p }, (r) => {
    let b = ''; r.on('data', (c) => (b += c));
    r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(new Error(b.slice(0, 200))); } });
  }).on('error', rej);
});

const PORT = await freePort();
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'hyalite-cases-'));
let chrome = null;
const cleanup = () => {
  try { chrome && chrome.kill('SIGKILL'); } catch { /* already gone */ }
  if (!KEEP) try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { /* best effort */ }
};
const die = (msg, code) => { console.error(msg); cleanup(); process.exit(code); };
process.on('SIGINT', () => die('interrupted', 130));
const guard = setTimeout(() => die('TIMEOUT: no result after 120 s', 2), 120000);

chrome = spawn(BROWSER, [
  '--headless=new', '--no-sandbox', '--disable-gpu',
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--disable-component-update', '--disable-default-apps', '--disable-sync', '--disable-extensions',
  '--window-size=1440,900',
  `--user-data-dir=${PROFILE}`,
  `--remote-debugging-port=${PORT}`,
  PAGE,
], { stdio: ['ignore', 'ignore', 'ignore'] });
chrome.on('error', (e) => die('could not start ' + BROWSER + ': ' + e.message, 2));

let target = null;
for (let i = 0; i < 40 && !target; i++) {
  await sleep(250);
  try { target = (await getJSON(PORT, '/json/list')).find((t) => t.type === 'page' && t.id); } catch { /* not up yet */ }
}
if (!target) die('the devtools endpoint never came up on 127.0.0.1:' + PORT, 2);

const ws = new WebSocket(`ws://127.0.0.1:${PORT}/devtools/page/${target.id}`);
let id = 0;
const pending = new Map();
ws.addEventListener('error', () => die('devtools websocket failed', 2));
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  // A thrown exception would otherwise just look like a page that never finishes.
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    console.error('page exception: ' + (d.exception && d.exception.description || d.text));
  }
});
const send = (method, params) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
await send('Runtime.enable');

/* The page sets window.__hyaliteCases when its last case has run. */
const r = await send('Runtime.evaluate', {
  expression: `new Promise((res) => {
    const t = setInterval(() => {
      if (window.__hyaliteCases) { clearInterval(t); res(JSON.stringify(window.__hyaliteCases)); }
    }, 100);
    setTimeout(() => {
      clearInterval(t);
      const out = document.getElementById('out');
      res(JSON.stringify({ ok: false, results: ['\\u2717 the page never finished \\u2014 ' + (out ? out.textContent : 'no #out')] }));
    }, 60000);
  })`,
  awaitPromise: true, returnByValue: true,
});
clearTimeout(guard);

const value = r.result && r.result.result && r.result.result.value;
if (!value) die('no result came back from the page', 2);
const { ok, results } = JSON.parse(value);
console.log(`${ok ? 'ALL OK' : 'FAILURES'}  ·  ${path.basename(BROWSER)}  ·  ${results.length} cases`);
results.forEach((line) => console.log(line));
cleanup();
process.exit(ok ? 0 : 1);
