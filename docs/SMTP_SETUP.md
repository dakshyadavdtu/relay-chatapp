# SMTP Setup (Placeholders)

This project supports SMTP for OTP/password reset emails via environment variables. Default values are placeholders only—add real credentials to `backend/.env` in your environment (never commit secrets).

## Environment variables
```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false          # true if using SMTPS/465
SMTP_USER=example@email.com
SMTP_PASS=example_password
SMTP_FROM="MyFrontend <no-reply@example.com>"
```

## Behavior
- If any of `SMTP_HOST`, `SMTP_USER`, or `SMTP_PASS` is missing, the mailer will **not** attempt SMTP. Instead, it logs the OTP to the console in dev: `[DEV OTP] email=<email> otp=<otp>`.
- When all SMTP vars are present, nodemailer sends via the configured host/port/secure/auth and uses `SMTP_FROM` as the sender.

## Where it is loaded
- Env is loaded via `backend/config/env.js` (`require('dotenv').config()`); `backend/services/mailer.js` reads the variables at runtime.

## What to do in your environment
1) Copy `backend/.env.example` to `backend/.env`.
2) Replace the placeholder SMTP values with your real SMTP host, credentials, and from address.
3) Restart the backend.
4) Trigger a password reset; in dev without SMTP set, check the server console for `[DEV OTP] ...`.

Secrets belong only in `backend/.env` (or your deployment secret store), never in source control.
