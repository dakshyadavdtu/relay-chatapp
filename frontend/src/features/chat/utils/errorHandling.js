/**
 * Stub: API error handling. Phase 3 no real API.
 */
export async function handleApiResponseError(res, _opts = {}) {
  const text = await res.text();
  return new Error(`${res.status}: ${text || res.statusText}`);
}
