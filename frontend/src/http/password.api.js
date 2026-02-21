/**
 * Password reset (OTP) API. Uses apiFetch with credentials.
 */
import { apiFetch } from '@/lib/http';

export async function forgotPassword(email) {
  const json = await apiFetch('/api/password/forgot', { method: 'POST', body: { email } });
  return json;
}

export async function verifyPasswordOTP(email, otp) {
  const json = await apiFetch('/api/password/verify', { method: 'POST', body: { email, otp } });
  return json;
}

export async function resetPassword(email, otp, newPassword) {
  const json = await apiFetch('/api/password/reset', { method: 'POST', body: { email, otp, newPassword } });
  return json;
}
