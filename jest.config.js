module.exports = {
  collectCoverageFrom: ['src/**/*.ts'],
  coveragePathIgnorePatterns: ['src/types.ts'],
  testEnvironment: 'node',
  moduleNameMapper: {
    '^filespy$': '<rootDir>/src/index.ts',
  },
  transform: {
    '\\.tsx?$': ['esbuild-jest', { sourcemap: true }],
  },
}
