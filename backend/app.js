'use strict';

// PHASE 1 — MOVED: Express app configuration only
// Server creation and WebSocket attachment moved to server.js
// HTTP routes moved to http/index.js (first-class HTTP subsystem)

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const httpRouter = require('./http');
const { corsMiddleware } = require('./http/middleware/cors.middleware');
const { allowedOrigins } = require('./config/origins');

const app = express();

// Serve uploaded files (e.g. group thumbnails) at /uploads
const uploadsDir = path.resolve(__dirname, 'storage', '_data', 'uploads');
app.use('/uploads', express.static(uploadsDir));

const isDev = process.env.NODE_ENV !== 'production';
// CSP connect-src: allow self + WebSocket. Dev: localhost origins (Vite 5173, backend 3001). Prod: allowedOrigins + ws/wss.
const connectSrc = isDev
  ? ["'self'", 'ws:', 'wss:', 'http://localhost:5173', 'http://localhost:3001', 'ws://localhost:3001', 'http://127.0.0.1:5173', 'http://127.0.0.1:3001', 'ws://127.0.0.1:3001']
  : ["'self'", 'ws:', 'wss:', ...allowedOrigins];

// Security headers: CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy
const cspDirectives = {
  'default-src': ["'self'"],
  'connect-src': connectSrc,
  'upgrade-insecure-requests': isDev ? null : [],
};
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: cspDirectives,
    },
    xFrameOptions: { action: 'deny' },
    xContentTypeOptions: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  })
);

// CORS: set Access-Control-* when Origin is allowed (before /api so all API routes get headers)
app.use(corsMiddleware);

// Health check for infra only (not part of HTTP subsystem)
app.get('/health', (req, res) => {
  res.status(200).json({ ok: true });
});
app.get('/api/health', (req, res) => {
  res.status(200).json({ ok: true });
});

// Metrics snapshot: counters + timestamp. Guarded by metricsAccessGuard (secret/open/disabled/admin).
const { metricsAccessGuard } = require('./http/middleware/metricsAccess.middleware');
const { handleMetrics } = require('./observability/metricsRoute');
app.get('/metrics', metricsAccessGuard, handleMetrics);

// Mount HTTP subsystem under /api so frontend proxy /api -> backend works
app.use('/api', httpRouter);

// PHASE 1 — Export only Express app
// HTTP server creation and WebSocket attachment moved to server.js
module.exports = app;
