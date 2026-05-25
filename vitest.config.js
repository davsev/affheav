import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Run all tests under tests/
    include: ['tests/**/*.test.{js,ts}'],

    // node environment for backend tests;
    // individual test files can override with @vitest-environment jsdom
    environment: 'node',

    // Show each test name in output
    reporter: 'verbose',

    coverage: {
      provider: 'v8',
      include: [
        'public/i18n/**',
        'routes/users.js',
        'services/userService.js',
        'db/migrate.js',
      ],
      reporter: ['text', 'lcov'],
    },

    // Allow importing the ESM files in public/i18n/ from CJS test files
    server: {
      deps: {
        inline: [/public\/i18n/],
      },
    },
  },
});
