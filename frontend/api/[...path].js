/**
 * Vercel Serverless Function: proxy /api/* to Render backend.
 * Accepts ALL HTTP methods (GET/POST/PUT/PATCH/DELETE/OPTIONS).
 * Set BACKEND_HTTP_URL in Vercel env (e.g. https://relay-chatapp.onrender.com).
 */

const BACKEND_ORIGIN = process.env.BACKEND_HTTP_URL || 'https://relay-chatapp.onrender.com';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://relay-chatapp-vercel-frontend.vercel.app';

function getRequestBody(req) {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
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

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.status(204).end();
    return;
  }

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
  const backendUrl = `${BACKEND_ORIGIN.replace(/\/$/, '')}${backendPath}${qs}`;

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
