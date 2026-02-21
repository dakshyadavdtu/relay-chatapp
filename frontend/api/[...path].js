/**
 * Vercel Serverless Function: proxy /api/* to Render backend.
 * Rewrites Set-Cookie to remove Domain so cookies become host-only for the Vercel domain (fixes 401 refresh/me).
 */

const BACKEND_ORIGIN = 'https://relay-chatapp.onrender.com';

function getRequestBody(req) {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      resolve(null);
      return;
    }
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : null));
    req.on('error', reject);
  });
}

/** Remove Domain=... from cookie string; ensure Path=/. */
function rewriteSetCookieHeader(cookieStr) {
  if (!cookieStr || typeof cookieStr !== 'string') return cookieStr;
  let s = cookieStr
    .replace(/\s*;\s*Domain=[^;]*/gi, '')
    .replace(/\s*;\s*Domain\s*=\s*[^;]*/gi, '');
  if (!/\bPath\s*=/i.test(s)) {
    s = s.trimEnd();
    s += (s.endsWith(';') ? ' ' : '; ') + 'Path=/';
  }
  return s;
}

export default async function handler(req, res) {
  const pathSegments = req.query.path;
  const path = Array.isArray(pathSegments) ? pathSegments.join('/') : (pathSegments || '');
  const backendPath = path ? `/api/${path}` : '/api';
  let qs = '';
  if (req.url && req.url.includes('?')) {
    qs = req.url.slice(req.url.indexOf('?'));
  } else if (req.query && Object.keys(req.query).length > 0) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query)) {
      if (k === 'path') continue;
      if (Array.isArray(v)) v.forEach((x) => params.append(k, x));
      else if (v != null) params.append(k, v);
    }
    const s = params.toString();
    if (s) qs = '?' + s;
  }
  const backendUrl = `${BACKEND_ORIGIN}${backendPath}${qs}`;

  const headers = {};
  const skipHeaders = ['host', 'connection', 'content-length'];
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (skipHeaders.includes(lower) || value === undefined) continue;
    headers[key] = value;
  }

  let body = null;
  try {
    body = await getRequestBody(req);
  } catch (e) {
    res.status(500).json({ error: 'Failed to read request body' });
    return;
  }

  const fetchOpts = {
    method: req.method || 'GET',
    headers,
    body: body,
    redirect: 'manual',
  };

  let backendRes;
  try {
    backendRes = await fetch(backendUrl, fetchOpts);
  } catch (e) {
    res.status(502).json({ error: 'Backend unreachable', message: e?.message });
    return;
  }

  res.status(backendRes.status);

  backendRes.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === 'set-cookie') return;
    res.setHeader(key, value);
  });

  let setCookies = [];
  if (typeof backendRes.headers.getSetCookie === 'function') {
    setCookies = backendRes.headers.getSetCookie();
  } else {
    const one = backendRes.headers.get('set-cookie');
    if (one) setCookies = [one];
  }
  if (setCookies.length > 0) {
    const rewritten = setCookies.map(rewriteSetCookieHeader);
    res.setHeader('Set-Cookie', rewritten);
  }

  const contentType = backendRes.headers.get('content-type') || '';
  if (backendRes.status === 204 || !backendRes.body) {
    res.end();
    return;
  }
  if (contentType.includes('application/json')) {
    const json = await backendRes.json();
    res.json(json);
  } else {
    const buf = await backendRes.arrayBuffer();
    res.send(Buffer.from(buf));
  }
}
