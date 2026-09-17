import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';

// Explicitly override inherited credentials for this project only.
const credentials = parseEnv(readFileSync(new URL('../.env.cloudflare.local', import.meta.url), 'utf8'));
if (credentials.CLOUDFLARE_ACCOUNT_ID !== 'ce3817013cde377ba7fbf0ca60e50ddc') {
  throw new Error('Unexpected calendar deployment account.');
}
if (!credentials.CLOUDFLARE_API_TOKEN || credentials.CLOUDFLARE_API_TOKEN.includes('PASTE_')) {
  throw new Error('Save the calendar deployment token before continuing.');
}
const env = { ...process.env, ...credentials };
delete env.CLOUDFLARE_API_KEY;
delete env.CLOUDFLARE_EMAIL;
const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...process.argv.slice(2)], {
  cwd: new URL('..', import.meta.url), env, stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
