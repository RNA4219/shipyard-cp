/**
 * Setup for tests
 * Increases max listeners to avoid warnings during parallel test execution
 */

// Vitest runs tests in parallel with multiple workers, each potentially adding listeners.
// Use a high value to accommodate parallel test execution without warnings.
process.setMaxListeners(100);

export default function globalSetup() {
  // Also set in global setup phase for the main process
  process.setMaxListeners(100);
}