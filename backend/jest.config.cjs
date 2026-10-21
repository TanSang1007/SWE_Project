module.exports = {
  testEnvironment: 'node', roots: ['<rootDir>/test'], testMatch: ['**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/test/database/'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  // D33 worker recycling also protects the expanded A06 HTTP regression on
  // Windows Node24. In-suite concurrent request assertions remain unchanged.
  maxWorkers: 1, workerIdleMemoryLimit: '1MB',
};
