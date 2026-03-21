/**
 * Setup for tests
 * Increases max listeners to avoid warnings during parallel test execution
 */

// Vitest runs tests in parallel with multiple workers, and many integration tests build
// app instances that attach process-level listeners. Disable the warning ceiling in tests.
process.setMaxListeners(0);

export default function globalSetup() {
  // Also set in global setup phase for the main process
  process.setMaxListeners(0);
}
