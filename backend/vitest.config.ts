import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/types.ts', 'src/generated/**', 'src/main.ts'],
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: {
        perFile: true,
        lines: 80,
        branches: 70,
        'src/features/todos/{validators,mappers}.ts': {
          statements: 100, branches: 100, functions: 100, lines: 100,
        },
      },
    },
  },
});
