import { defineConfig, devices } from "@playwright/test";

/**
 * See https://playwright.dev/docs/test-configuration.
 */

export default defineConfig({
  testDir: "./",
  testMatch: /.*\.play\.ts/,
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: "html",
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: "http://127.0.0.1:8085",

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: "on-first-retry",
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "nodejs",
      testMatch: /node.play.ts/,
    },

    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        contextOptions: {
          logger: {
            isEnabled: (name, severity) =>
              name === "browser" || severity == "error",
            log: (name, severity, message, args) =>
              console.log(`${name} ${severity} ${message}`),
          },
        },
      },
      testMatch: /browser.play.ts/,
    },

    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        contextOptions: {
          logger: {
            isEnabled: (name, severity) =>
              name === "browser" || severity == "error",
            log: (name, severity, message, args) =>
              console.log(`${name} ${severity} ${message}`),
          },
        },
      },
      testMatch: /browser.play.ts/,
    },

    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    //   testMatch: /browser.play.ts/,
    // },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ..devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: "npx http-server ./ -p 8085",
    port: 8085,
  },
});
