/**
 * Jest configuration for ESKAN backend unit tests.
 *
 * NestJS v12 ships ESM-only packages (`@nestjs/*` are `"type": "module"`).
 * Jest 30 can `require()` these ESM-only packages natively, but only when
 * Node is started with `--experimental-vm-modules` (which exposes
 * `vm.SourceTextModule`). `scripts/run-jest.cjs` sets that flag in
 * `NODE_OPTIONS` before launching Jest, so the ESM packages are left
 * untransformed in `node_modules` and loaded via Jest's native ESM path.
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};