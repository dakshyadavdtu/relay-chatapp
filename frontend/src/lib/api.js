/**
 * Dev-only health ping. Uses Vite proxy /api -> backend.
 */
import { apiFetch } from './http';

export async function pingHealth() {
  try {
    const json = await apiFetch('/api/health');
    return { ok: true, json };
  } catch (e) {
    return { ok: false, json: null, error: e };
  }
}
