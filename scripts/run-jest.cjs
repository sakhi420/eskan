'use strict';

/**
 * Launches Jest with `--experimental-vm-modules` in NODE_OPTIONS.
 *
 * NestJS v12 is ESM-only; Jest 30's native `require(esm)` path (used to load
 * `@nestjs/*` and other ESM-only deps from CommonJS tests) is gated on
 * `vm.SourceTextModule.prototype.hasAsyncGraph`, which only exists when Node
 * is started with `--experimental-vm-modules`. Setting it here keeps the
 * command cross-platform and the flag inherited by Jest's worker processes
 * through the environment.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const flag = '--experimental-vm-modules';
const existing = process.env.NODE_OPTIONS || '';
process.env.NODE_OPTIONS = existing.includes(flag) ? existing : `${existing} ${flag}`.trim();

const jestBin = require.resolve('jest/bin/jest');
const result = spawnSync(process.execPath, [jestBin, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(typeof result.status === 'number' ? result.status : 1);