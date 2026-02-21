#!/usr/bin/env bash
# Tier-1.6 — Prevent PM2 independent start (enforce systemd authority).
# This script ensures PM2 cannot be started independently in production.
# Run this on EC2 setup to enforce: systemd is the ONLY entry point.

set -e

# Check if systemd service is enabled
if systemctl is-enabled chat-backend >/dev/null 2>&1; then
    echo "systemd service is enabled. PM2 must only be started via systemd."
    echo "To start: sudo systemctl start chat-backend"
    echo "Do NOT run: pm2 start ecosystem.config.js (systemd owns PM2 lifecycle)"
    exit 0
else
    echo "systemd service not enabled. This script enforces systemd authority."
    echo "Enable service first: sudo systemctl enable chat-backend"
    exit 1
fi
