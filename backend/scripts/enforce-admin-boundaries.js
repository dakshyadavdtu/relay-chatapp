#!/usr/bin/env node
'use strict';

/**
 * PHASE 6 — Admin boundary enforcement.
 * Scans backend/ for security boundary violations.
 * FAILS the build (exit 1) on violation. No warnings. No silent passes.
 */

const fs = require('fs');
const path = require('path');

const backendRoot = path.resolve(__dirname, '..');

/**
 * Rule A — Admin recovery isolation
 * No admin WS handler logic outside admin/
 */
function checkRuleA(filePath, relPath, content) {
  const violations = [];
  
  // Skip scripts/ directory (enforcement scripts are allowed)
  if (relPath.startsWith('scripts/')) {
    return violations;
  }

  // Skip admin/ directory (allowed - at backend root)
  if (relPath.startsWith('admin/')) {
    return violations;
  }

  // Skip recovery/ directory (allowed to clear adminSubscribed, but not handle admin logic)
  if (relPath.startsWith('websocket/recovery/')) {
    // Recovery can clear adminSubscribed but not register handlers
    // Check for actual handler registration (not just references in comments)
    const handlerRegistrationPatterns = [
      /\bhandleAdminMessage\s*\(/, // Function definition or call
      /\badminSubscribed\s*=\s*true/, // Setting adminSubscribed
    ];
    
    for (const pattern of handlerRegistrationPatterns) {
      if (pattern.test(content)) {
        violations.push({
          rule: 'Rule A',
          reason: 'Admin WS handler registration outside admin/ directory',
        });
        break;
      }
    }
    return violations;
  }

  // Check for admin WS handler logic outside admin/
  // Use more specific patterns to avoid false positives from comments/strings
  const adminHandlerPatterns = [
    /\badminSubscribed\s*=\s*true/, // Setting adminSubscribed (handler registration)
    /\bhandleAdminMessage\s*\(/, // Admin message handler function
    /\bAdminMessageType\s*\./, // Using AdminMessageType enum
  ];

  for (const pattern of adminHandlerPatterns) {
    if (pattern.test(content)) {
      violations.push({
        rule: 'Rule A',
        reason: 'Admin WS handler logic outside admin/ directory',
      });
      break;
    }
  }

  return violations;
}

/**
 * Rule B — Observability read model enforcement
 * No file outside observability/ may create observability-style read models
 * (aggregation, reporting, metrics from websocket/state)
 * 
 * Operational reads are allowed (handlers, services need state for operations)
 * But creating new observability/read-model patterns is forbidden
 */
function checkRuleB(filePath, relPath, content) {
  const violations = [];
  
  // Skip observability/ directory (allowed - at backend root)
  if (relPath.startsWith('observability/')) {
    return violations;
  }

  // Skip websocket/state/ directory (state owns itself)
  if (relPath.startsWith('websocket/state/')) {
    return violations;
  }

  // Skip websocket/connection/ directory (connectionManager owns itself)
  if (relPath.startsWith('websocket/connection/connectionManager')) {
    return violations;
  }

  // Skip HTTP directory (HTTP doesn't create observability models)
  if (relPath.startsWith('http/')) {
    return violations;
  }

  // Check for observability-style patterns (creating read models)
  // These patterns indicate creating observability/aggregation logic outside observability/
  const observabilityPatterns = [
    /aggregate.*connection/i, // Aggregating connections
    /aggregate.*message/i, // Aggregating messages
    /aggregate.*latency/i, // Aggregating latency
    /getSnapshot/i, // Creating snapshots
    /observability/i, // Observability logic
    /metrics.*aggregate/i, // Metrics aggregation
    /read.*model/i, // Read model creation
  ];

  // Also check if file imports state/connectionManager for observability purposes
  // (not operational purposes)
  const hasStateImport = /require\(['"]\.\.\/state\//.test(content) || 
                         /require\(['"]\.\.\/\.\.\/state\//.test(content) ||
                         /require\(['"]\.\.\/connection\/connectionManager/.test(content);
  
  const hasObservabilityPattern = observabilityPatterns.some(p => p.test(content));

  if (hasStateImport && hasObservabilityPattern) {
    violations.push({
      rule: 'Rule B',
      reason: 'Creating observability-style read model outside observability/ directory',
    });
  }

  return violations;
}

/**
 * Rule C — No UI-triggerable admin paths
 * No HTTP routes may mutate admin WS state or trigger admin events
 */
function checkRuleC(filePath, relPath, content) {
  const violations = [];
  
  // Only check HTTP routes
  if (!relPath.startsWith('http/')) {
    return violations;
  }

  // Skip admin routes (admin HTTP routes are allowed)
  if (relPath.startsWith('http/routes/admin.routes.js') || 
      relPath.startsWith('http/controllers/admin.controller.js')) {
    return violations;
  }

  // Check for admin WS state mutation or event triggering
  const forbiddenPatterns = [
    /adminSubscribed\s*=/i, // Mutating admin WS state
    /admin.*router/i, // Using admin router
    /admin.*events/i, // Triggering admin events
    /emitAdminSystemEvent/i, // Emitting admin events
    /handleAdminMessage/i, // Handling admin messages
  ];

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(content)) {
      violations.push({
        rule: 'Rule C',
        reason: 'HTTP route mutating admin WS state or triggering admin events',
      });
      break;
    }
  }

  return violations;
}

/**
 * Get all JavaScript files in backend/
 */
function getAllJsFiles(dir, baseDir, list) {
  if (!list) list = [];
  if (!baseDir) baseDir = dir;
  if (!fs.existsSync(dir)) return list;
  
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.relative(baseDir, full).replace(/\\/g, '/');
    
    if (e.isDirectory()) {
      // Skip node_modules and other build artifacts
      if (e.name === 'node_modules' || e.name === '.git') continue;
      getAllJsFiles(full, baseDir, list);
    } else if (e.isFile() && e.name.endsWith('.js')) {
      list.push({ full, rel });
    }
  }
  return list;
}

/**
 * Scan a file for violations
 */
function scanFile(filePath, relPath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const violations = [];

  // Check all rules
  violations.push(...checkRuleA(filePath, relPath, content));
  violations.push(...checkRuleB(filePath, relPath, content));
  violations.push(...checkRuleC(filePath, relPath, content));

  return violations;
}

/**
 * Main enforcement function
 */
function main() {
  const jsFiles = getAllJsFiles(backendRoot);
  const errors = [];

  for (const { full, rel } of jsFiles) {
    const violations = scanFile(full, rel);
    for (const v of violations) {
      errors.push({
        file: rel,
        rule: v.rule,
        reason: v.reason,
      });
    }
  }

  if (errors.length === 0) {
    console.log('Admin boundary enforcement PASSED: no violations detected.');
    process.exit(0);
  }

  // Print violations and fail
  console.error('\n❌ Admin boundary enforcement FAILED.');
  console.error('Security boundary violations detected.\n');
  
  errors.forEach((e) => {
    console.error(`  File: ${e.file}`);
    console.error(`  Rule: ${e.rule}`);
    console.error(`  Reason: ${e.reason}`);
    console.error('');
  });

  console.error(`Total violations: ${errors.length}`);
  console.error('\nBuild MUST fail. Fix violations before proceeding.\n');
  process.exit(1);
}

main();
