/**
 * Tier-1.6 — PM2 ecosystem config (authoritative; used by systemd).
 * Authority chain: systemd (authority) → PM2 (process supervisor) → Node app
 * 
 * PM2 is subordinate to systemd:
 * - systemd starts PM2 via ExecStart (with --no-daemon)
 * - systemd owns PM2 lifecycle (restart on crash)
 * - PM2 manages Node lifecycle (restart on crash, memory limits)
 * 
 * What fails if PM2 is not used:
 * - Node crash leaves no process; no auto-restart until systemd or manual intervention.
 * - No unified process name for restart/logs (e.g. pm2 restart chat-backend).
 * 
 * Why max_memory_restart exists:
 * - Prevents runaway memory from taking down the box; PM2 restarts the process before OOM.
 * 
 * Fallback chain:
 * - Node crash → PM2 restarts Node (autorestart)
 * - PM2 crash → systemd restarts PM2 (Restart=always)
 */
const path = require('path');

const appRoot = __dirname;

module.exports = {
  apps: [
    {
      name: 'chat-backend',
      script: path.join(appRoot, 'server.js'),
      cwd: appRoot,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,
      kill_timeout: 5000,
      listen_timeout: 10000,
      shutdown_with_message: true,

      env: { NODE_ENV: 'development' },
      env_production: { NODE_ENV: 'production' },

      error_file: '/var/log/chat-backend/pm2-error.log',
      out_file: '/var/log/chat-backend/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      log_type: 'json',
    },
  ],
};
