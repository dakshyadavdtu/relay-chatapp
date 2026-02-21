/**
 * API base path. Always relative (/api) so requests go through frontend origin and proxy;
 * cookies then attach. Do NOT set VITE_API_URL to an absolute backend URL (e.g. http://localhost:8000).
 */
export const API_BASE = '/api';
