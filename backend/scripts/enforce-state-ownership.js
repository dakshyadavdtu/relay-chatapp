#!/usr/bin/env node
'use strict';

/**
 * PHASE 7 — State ownership enforcement.
 * Scans all *.js for new Map( / new Set( outside websocket/state/**.
 * FAILS the build (exit 1) on violation. No warnings. No silent passes.
 */

const fs = require('fs');
const path = require('path');

const backendRoot = path.resolve(__dirname, '..');

/** Only these paths may contain Map/Set outside websocket/state/. This script + legacy. */
const ALLOWLIST = new Set([
  'scripts/enforce-state-ownership.js',
  'config/db.js',
  'storage/user.store.js', // Phase 6A: real user storage (id, username, passwordHash)
  'services/message.service.js',
  'utils/logger.js',
  'utils/monitoring.js',
  'services/delivery.and.offline.semantics/core/offline/offline.logic.js',
  'services/group.chat/core/rooms/room.membership.js',
  'services/group.chat/core/rooms/room.manager.js',
  'services/group.chat/core/rooms/room.logic.js',
  'services/message.core/core/messaging/message.logic.js',
]);

function getAllJsFiles(dir, baseDir, list) {
  if (!list) list = [];
  if (!baseDir) baseDir = dir;
  if (!fs.existsSync(dir)) return list;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.relative(baseDir, full).replace(/\\/g, '/');
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue;
      getAllJsFiles(full, baseDir, list);
    } else if (e.isFile() && e.name.endsWith('.js')) {
      list.push({ full, rel });
    }
  }
  return list;
}

function isAllowed(relPath) {
  if (relPath.startsWith('websocket/state/')) return true;
  if (ALLOWLIST.has(relPath)) return true;
  return false;
}

function scanFile(filePath, relPath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const violations = [];
  const mapRe = /\bnew\s+Map\s*\(/;
  const setRe = /\bnew\s+Set\s*\(/;
  const isTest = relPath.startsWith('tests/') && (relPath.endsWith('.test.js') || relPath.endsWith('.spec.js'));
  const allowComment = /\/\/\s*ALLOW_MAP(\s*—\s*TEST MOCK ONLY)?/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const allowLine = isTest && allowComment.test(line);
    if (mapRe.test(line) && !allowLine) violations.push({ line: i + 1, rule: 'new Map()', snippet: line.trim() });
    if (setRe.test(line) && !allowLine) violations.push({ line: i + 1, rule: 'new Set()', snippet: line.trim() });
  }
  return violations;
}

function main() {
  const jsFiles = getAllJsFiles(backendRoot);
  const errors = [];

  for (const { full, rel } of jsFiles) {
    if (isAllowed(rel)) continue;
    const violations = scanFile(full, rel);
    for (const v of violations) {
      errors.push({ file: rel, line: v.line, rule: v.rule, snippet: v.snippet });
    }
  }

  if (errors.length === 0) {
    console.log('State ownership enforcement PASSED: no Map/Set outside websocket/state/ (or allowlist).');
    process.exit(0);
  }

  console.error('\nState ownership enforcement FAILED.');
  console.error('new Map() and new Set() are FORBIDDEN outside websocket/state/**.');
  console.error('See docs: PHASE 7 — ARCHITECTURAL FALLBACKS.\n');
  errors.forEach(function (e) {
    console.error('  ❌ file path:   ' + e.file);
    console.error('  ❌ line number: ' + e.line);
    console.error('  ❌ rule violated: ' + e.rule + ' forbidden outside websocket/state/');
    console.error('  CODE:   ' + (e.snippet.length > 80 ? e.snippet.slice(0, 80) + '...' : e.snippet));
    console.error('');
  });
  console.error('Total violations: ' + errors.length);
  process.exit(1);
}

main();
