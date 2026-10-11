import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

// Playwright normally forces pages to behave as visible. This owned, temporary
// Chrome profile uses noDefaults so hidden-tab tests exercise real throttling.
export async function realBrowser() {
  const profile = await mkdtemp(join(tmpdir(), 'lecturelens-browser-'));
  const executable = process.platform === 'win32' ? join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe')
    : process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/opt/google/chrome/chrome';
  const child = spawn(executable, ['--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-backgrounding-occluded-windows', '--window-position=-2400,0', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let failure: Error | undefined; child.on('error', e => { failure = e; });
  let port = '';
  for (let i = 0; i < 100; i++) {
    if (failure) throw failure;
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  if (!port) { child.kill(); throw new Error('Chrome debugging endpoint did not start'); }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
  const context = browser.contexts()[0], page = context.pages()[0];
  return { context, page, close: async () => {
    child.kill(); await browser.close().catch(() => {});
    const target = resolve(profile), allowed = resolve(tmpdir()) + sep + 'lecturelens-browser-';
    if (!target.startsWith(allowed)) throw new Error('Unexpected temporary browser profile path');
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  } };
}
