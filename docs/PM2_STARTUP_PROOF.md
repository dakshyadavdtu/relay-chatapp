# PM2 Startup Integration Proof

## Commands to Enable PM2 Startup

After starting PM2 with `pm2 start ecosystem.config.js`, run:

```bash
# Save current PM2 process list
pm2 save

# Generate startup script
pm2 startup

# Follow the output command (example):
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu
```

## Verification

After running `pm2 startup`:

1. **Check systemd service exists:**
   ```bash
   sudo systemctl status pm2-ubuntu
   ```

2. **Test reboot:**
   ```bash
   sudo reboot
   # After reboot, verify:
   pm2 status
   # Should show chat-backend running
   ```

3. **Check PM2 logs:**
   ```bash
   pm2 logs chat-backend
   ```

## Expected Behavior

- PM2 starts automatically on system boot
- `chat-backend` process is restored from saved list
- Process restarts on crash (configured in ecosystem.config.js)
- Logs persist across reboots

## Troubleshooting

If PM2 doesn't start on boot:

```bash
# Regenerate startup script
pm2 unstartup
pm2 startup

# Manually start if needed
pm2 start ecosystem.config.js --env production
pm2 save
```
