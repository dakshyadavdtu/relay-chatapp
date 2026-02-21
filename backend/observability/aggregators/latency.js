'use strict';

/**
 * Latency metrics aggregator.
 * Tracks latency measurements (read-only aggregation).
 * NEVER mutates state.
 * NEVER throws - always returns safe defaults.
 */

// Latency tracking (in-memory, ephemeral)
const latencyMeasurements = [];
const MAX_MEASUREMENTS = 1000; // Keep last 1000 measurements

/**
 * Get latency summary
 * @param {Object} state - State object (may be undefined/null)
 * @returns {Object} Latency metrics (always safe, never throws)
 */
function getLatencySummary(state) {
  try {
    // Missing samples → null or zero values
    let measurements = [];
    try {
      // Copy measurements for calculation (read-only)
      measurements = Array.isArray(latencyMeasurements) ? [...latencyMeasurements] : [];
    } catch {
      measurements = [];
    }

    if (measurements.length === 0) {
      return {
        avgLatency: 0,
        p95Latency: 0,
        maxLatency: 0,
        sampleCount: 0,
      };
    }

    // Filter valid numbers only
    const validMeasurements = measurements.filter(
      m => typeof m === 'number' && m >= 0 && isFinite(m)
    );

    if (validMeasurements.length === 0) {
      return {
        avgLatency: 0,
        p95Latency: 0,
        maxLatency: 0,
        sampleCount: 0,
      };
    }

    // Sort for percentile calculation
    const sorted = [...validMeasurements].sort((a, b) => a - b);

    // Calculate average
    const sum = sorted.reduce((acc, val) => acc + val, 0);
    const average = sum / sorted.length;

    // Calculate P95 (95th percentile)
    const p95Index = Math.ceil(sorted.length * 0.95) - 1;
    const p95 = sorted[Math.max(0, p95Index)] || 0;

    // Calculate max
    const max = sorted[sorted.length - 1] || 0;

    return {
      avgLatency: Math.round(average * 100) / 100, // Round to 2 decimals
      p95Latency: Math.round(p95 * 100) / 100,
      maxLatency: Math.round(max * 100) / 100,
      sampleCount: validMeasurements.length,
    };

    // NO per-user breakdown exposed
    // NO raw sample exposure
  } catch {
    // On ANY error, return safe default
    return {
      avgLatency: 0,
      p95Latency: 0,
      maxLatency: 0,
      sampleCount: 0,
    };
  }
}

/**
 * Record a latency measurement (internal)
 * Called internally when latency is observed
 * @param {number} latencyMs - Latency in milliseconds
 */
function _recordLatency(latencyMs) {
  try {
    if (typeof latencyMs !== 'number' || latencyMs < 0 || !isFinite(latencyMs)) {
      return;
    }

    if (Array.isArray(latencyMeasurements)) {
      latencyMeasurements.push(latencyMs);

      // Keep only last MAX_MEASUREMENTS
      if (latencyMeasurements.length > MAX_MEASUREMENTS) {
        latencyMeasurements.shift();
      }
    }
  } catch {
    // Silently fail - summary will handle empty array
  }
}

/**
 * Public API: record a latency sample. Defensive: ignores invalid input; never throws.
 * @param {number} latencyMs - Latency in milliseconds
 */
function recordLatency(latencyMs) {
  try {
    if (latencyMs == null || typeof latencyMs !== 'number' || latencyMs < 0 || !Number.isFinite(latencyMs)) {
      return;
    }
    _recordLatency(latencyMs);
  } catch (_) {
    // no-op
  }
}

module.exports = {
  getLatencySummary,
  _recordLatency,
  recordLatency,
};
