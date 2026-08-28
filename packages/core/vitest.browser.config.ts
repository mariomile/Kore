import { playwright } from '@vitest/browser-playwright'
import { defineProject } from 'vitest/config'

const browserName = process.env.REFLECT_TEST_BROWSER === 'webkit' ? 'webkit' : 'chromium'

export default defineProject({
  test: {
    name: 'core-browser',
    include: ['src/**/*.test.tsx'],
    // Distinct from the desktop browser project's 100: same group order with
    // different `maxWorkers` aborts the whole run before a single test starts.
    sequence: { groupOrder: 101 },
    retry: process.env.CI ? 3 : 0,
    browser: {
      enabled: true,
      provider: playwright(),
      headless: !process.env.DEBUG,
      instances: [{ browser: browserName }],
    },
  },
})
