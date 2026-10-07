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
const preferredFrontendPort = Number(process.env.CALENDAR_DEV_PORT || 5173);
if (!Number.isInteger(preferredFrontendPort) || preferredFrontendPort < 1024 || preferredFrontendPort > 65535) {
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
function run(script, args, persistent = false, extraEnv = {}) {
  const child = spawn(runtime, [script, ...args], {
    // Only the launcher owns terminal input, so child key handlers cannot swallow Ctrl+C.
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, ...(!persistent ? { CI: 'true' } : {}), ...extraEnv },
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
    server.once('error', reject);
    server.listen(port, host, () => server.close(resolve));
  });
}

async function selectPort(preferredPort, host, label) {
  const lastPort = Math.min(preferredPort + 10, 65535);
  for (let port = preferredPort; port <= lastPort; port++) {
    try {
      await requirePort(port, host);
      return port;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
      console.log(`${label} port ${port} is busy; trying the next port.`);
    }
  }
  throw new Error(`No ${label.toLowerCase()} port is available from ${preferredPort} through ${lastPort}. Stop an earlier development server and retry.`);
}

async function waitForServer(url, label) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      /* Server is starting. */
    }
    await delay(300);
  }
  throw new Error(`The local ${label} did not become ready within 60 seconds.`);
}

try {
  const frontendPort = await selectPort(preferredFrontendPort, 'localhost', 'Frontend');
  const backendPort = await selectPort(8787, '127.0.0.1', 'Backend');
  const backendUrl = `http://127.0.0.1:${backendPort}`;
  console.log('Starting the local calendar backend and frontend…');
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
    ['dev', '--local', '--ip', '127.0.0.1', '--port', String(backendPort), '--inspector-port', '0'],
    true,
  );
  await waitForServer(`${backendUrl}/api/config`, 'backend');
  void run(
    'node_modules/vite/bin/vite.js',
    ['--host', 'localhost', '--port', String(frontendPort), '--strictPort'],
    true,
    { CALENDAR_BACKEND_URL: backendUrl },
  );
  await waitForServer(`http://localhost:${frontendPort}`, 'frontend');
  console.log(`\nCalendar ready. Open http://localhost:${frontendPort} — Ctrl+C stops both servers.\n`);
} catch (error) {
  console.error(error.message);
  stop(1);
}
