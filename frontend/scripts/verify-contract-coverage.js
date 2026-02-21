#!/usr/bin/env node
/**
 * Phase 5.5: Contract enforcement checks.
 * Compares backend/CONTRACT.json with frontend coverage.json.
 * Exits 1 if checks fail.
 *
 * Checks:
 * 1. Every backend WS type (incoming + outgoing) exists in coverage
 * 2. Every backend HTTP endpoint used in chat exists in coverage
 * 3. Every entry with handled=true has a valid handlerPath (file exists when path is src/...)
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = join(__dirname, "..");
// Project root (parent of myfrontend) contains backend/
const BACKEND_ROOT = join(FRONTEND_ROOT, "..", "..");

function loadJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`Failed to load ${path}:`, e.message);
    process.exit(1);
  }
}

function main() {
  const contractPath = join(BACKEND_ROOT, "backend", "CONTRACT.json");
  const coveragePath = join(FRONTEND_ROOT, "src", "contracts", "coverage.json");

  if (!existsSync(contractPath)) {
    console.error(`CONTRACT not found: ${contractPath}`);
    process.exit(1);
  }
  if (!existsSync(coveragePath)) {
    console.error(`Coverage not found: ${coveragePath}`);
    process.exit(1);
  }

  const contract = loadJson(contractPath);
  const coverage = loadJson(coveragePath);

  const errors = [];

  // 1. WS incoming types
  const contractIncoming = (contract?.websocket?.incomingMessageTypes ?? []).map((t) => t.type);
  const coverageIncoming = Object.keys(coverage?.websocket?.incoming ?? {});
  for (const type of contractIncoming) {
    if (!coverageIncoming.includes(type)) {
      errors.push(`WS incoming type missing from coverage: ${type}`);
    }
  }

  // 2. WS outgoing types
  const contractOutgoing = (contract?.websocket?.outgoingMessageTypes ?? []).map((t) => t.type);
  const coverageOutgoing = Object.keys(coverage?.websocket?.outgoing ?? {});
  for (const type of contractOutgoing) {
    if (!coverageOutgoing.includes(type)) {
      errors.push(`WS outgoing type missing from coverage: ${type}`);
    }
  }

  // 3. HTTP endpoints used in chat (core chat flow)
  const chatEndpoints = [
    "GET /health",
    "POST /register",
    "POST /login",
    "POST /logout",
    "GET /me",
    "GET /chats",
    "GET /chat",
    "POST /chat/send",
    "GET /sessions/active",
    "POST /sessions/logout",
    "POST /admin/users/:id/role",
  ];
  const coverageHttp = coverage?.http ?? {};
  for (const key of chatEndpoints) {
    if (!(key in coverageHttp)) {
      errors.push(`HTTP endpoint missing from coverage: ${key}`);
    }
  }

  // Also ensure all CONTRACT http endpoints exist in coverage
  const contractEndpoints = contract?.http?.endpoints ?? [];
  for (const ep of contractEndpoints) {
    const key = `${ep.method} ${ep.path}`;
    if (!(key in coverageHttp)) {
      errors.push(`HTTP endpoint missing from coverage: ${key}`);
    }
  }

  // 4. handled=true but handler file missing
  const entries = [
    ...Object.entries(coverageHttp),
    ...Object.entries(coverage?.websocket?.incoming ?? {}),
    ...Object.entries(coverage?.websocket?.outgoing ?? {}),
  ];

  for (const [name, entry] of entries) {
    if (entry?.handled !== true) continue;
    const hp = entry.handlerPath;
    if (!hp || typeof hp !== "string") continue;

    // Extract first src/... path (before space, parenthesis, or +)
    const match = hp.match(/src\/[^\s(+]+/);
    if (!match) continue;

    const relPath = match[0];
    const absPath = join(FRONTEND_ROOT, relPath);
    if (!existsSync(absPath)) {
      errors.push(`handled=true but handler file missing: ${name} -> ${relPath}`);
    }
  }

  if (errors.length > 0) {
    console.error("Contract coverage verification FAILED:\n");
    errors.forEach((e) => console.error("  -", e));
    process.exit(1);
  }

  console.log("Contract coverage verification PASSED.");
}

main();
