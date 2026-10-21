module.exports = {
  testEnvironment: 'node', roots: ['<rootDir>/test/database'], testMatch: ['**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  // Recycle the single child process after every suite. Windows Node24/Prisma
  // native termination recurred with multiple suites in one process; isolated
  // suites passed. Tests inside each suite still exercise concurrent requests.
  maxWorkers: 1, workerIdleMemoryLimit: '1MB',
  testTimeout: 30000,
};
