import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const compatible = (version) => {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 12);
};
let runtime = process.env.CALENDAR_NODE || process.execPath;
if (!process.env.CALENDAR_NODE && !compatible(process.versions.node)) {
  const bundled = join(
    homedir(),
    '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin',
    process.platform === 'win32' ? 'node.exe' : 'node',
  );
  if (existsSync(bundled)) runtime = bundled;
}
const version = spawnSync(runtime, ['--version'], { encoding: 'utf8' }).stdout?.trim();
if (!version || !compatible(version)) {
  console.error(
    'Local development requires Node 22.12+ (Node 24 recommended). Install it or set CALENDAR_NODE to its executable.',
  );
  process.exit(1);
}
if (runtime !== process.execPath) console.log(`Using Node ${version}: ${runtime}`);

const children = new Set();
const frontendPort = Number(process.env.CALENDAR_DEV_PORT || 5173);
if (!Number.isInteger(frontendPort) || frontendPort < 1024 || frontendPort > 65535) {
  throw new Error('CALENDAR_DEV_PORT must be a port from 1024 to 65535.');
}
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* Already exited. */
      }
    }
  }
  process.exit(code);
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
function run(script, args, persistent = false) {
  const child = spawn(runtime, [script, ...args], {
    // Only the launcher owns terminal input, so child key handlers cannot swallow Ctrl+C.
    stdio: ['ignore', 'inherit', 'inherit'],
    env: persistent ? process.env : { ...process.env, CI: 'true' },
    detached: process.platform !== 'win32',
  });
  children.add(child);
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => {
      children.delete(child);
      if (persistent && !stopping) {
        console.error('A development server stopped; shutting down the other server.');
        stop(code || 1);
      }
      code === 0 ? resolve() : reject(new Error(`${script} exited with code ${code}`));
    });
  });
  if (persistent)
    void done.catch((error) => {
      console.error(error.message);
      stop(1);
    });
  return done;
}
async function requirePort(port, host) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () =>
      reject(
        new Error(
          `Port ${port} is already in use. Stop the existing development server and run npm run dev again.`,
        ),
      ),
    );
    server.listen(port, host, () => server.close(resolve));
  });
}

try {
  await requirePort(frontendPort, 'localhost');
  await requirePort(8787, '127.0.0.1');
  // Wrangler needs its static asset directory even when Vite serves the frontend.
  if (!existsSync('dist/index.html')) await run('node_modules/vite/bin/vite.js', ['build']);
  await run('node_modules/wrangler/bin/wrangler.js', [
    'd1',
    'migrations',
    'apply',
    'DB',
    '--local',
  ]);
  void run(
    'node_modules/wrangler/bin/wrangler.js',
    ['dev', '--local', '--ip', '127.0.0.1', '--port', '8787'],
    true,
  );
  const deadline = Date.now() + 60_000;
  let ready = false;
  while (Date.now() < deadline && !ready) {
    try {
      const response = await fetch('http://127.0.0.1:8787/api/config', {
        signal: AbortSignal.timeout(1000),
      });
      ready = response.ok;
    } catch {
      /* Backend is starting. */
    }
    if (!ready) await delay(300);
  }
  if (!ready) throw new Error('The local backend did not become ready within 60 seconds.');
  console.log(
    `\nBackend ready. Open http://localhost:${frontendPort} — Ctrl+C stops both servers.\n`,
  );
  await run(
    'node_modules/vite/bin/vite.js',
    ['--host', 'localhost', '--port', String(frontendPort), '--strictPort'],
    true,
  );
} catch (error) {
  console.error(error.message);
  stop(1);
}
