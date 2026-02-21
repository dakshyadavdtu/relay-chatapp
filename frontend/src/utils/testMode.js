/**
 * Test Mode Utility
 * Checks if TEST MODE is enabled via VITE_TEST_MODE environment variable
 */
export function isTestMode() {
  const envValue = import.meta.env.VITE_TEST_MODE;
  const testMode = envValue === "true" || envValue === true;

  if (typeof window !== "undefined" && !window.__TEST_MODE_LOGGED) {
    window.__TEST_MODE_LOGGED = true;
  }

  return testMode;
}

/**
 * Create a mock Response object that mimics fetch Response
 */
export function createMockResponse(data, status = 200, url = "/api/mock") {
  const mockHeaders = new Headers({
    "Content-Type": "application/json",
  });

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : status === 201 ? "Created" : status === 404 ? "Not Found" : "Error",
    url,
    json: async () => Promise.resolve(data),
    text: async () => Promise.resolve(JSON.stringify(data)),
    headers: mockHeaders,
    get: (name) => mockHeaders.get(name),
  };
}
