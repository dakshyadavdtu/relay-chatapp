'use strict';

/**
 * Lightweight input validation helpers.
 * No heavy schema libraries - simple type and length checks.
 */

/**
 * Validate required string field
 * @param {*} value - Value to validate
 * @param {string} fieldName - Field name for error message
 * @param {number} [minLength] - Minimum length
 * @param {number} [maxLength] - Maximum length
 * @returns {{ valid: boolean, error?: string }}
 */
function validateRequiredString(value, fieldName, minLength = 1, maxLength = undefined) {
  if (value === undefined || value === null) {
    return { valid: false, error: `${fieldName} is required` };
  }
  if (typeof value !== 'string') {
    return { valid: false, error: `${fieldName} must be a string` };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: `${fieldName} cannot be empty` };
  }
  if (trimmed.length < minLength) {
    return { valid: false, error: `${fieldName} must be at least ${minLength} characters` };
  }
  if (maxLength !== undefined && trimmed.length > maxLength) {
    return { valid: false, error: `${fieldName} must be at most ${maxLength} characters` };
  }
  return { valid: true };
}

/**
 * Validate optional string field
 * @param {*} value - Value to validate
 * @param {string} fieldName - Field name for error message
 * @param {number} [maxLength] - Maximum length
 * @returns {{ valid: boolean, error?: string }}
 */
function validateOptionalString(value, fieldName, maxLength = undefined) {
  if (value === undefined || value === null) {
    return { valid: true }; // Optional field
  }
  if (typeof value !== 'string') {
    return { valid: false, error: `${fieldName} must be a string` };
  }
  if (maxLength !== undefined && value.length > maxLength) {
    return { valid: false, error: `${fieldName} must be at most ${maxLength} characters` };
  }
  return { valid: true };
}

/**
 * Validate positive integer
 * @param {*} value - Value to validate
 * @param {string} fieldName - Field name for error message
 * @param {number} [min] - Minimum value
 * @param {number} [max] - Maximum value
 * @returns {{ valid: boolean, error?: string, value?: number }}
 */
function validatePositiveInteger(value, fieldName, min = 1, max = undefined) {
  if (value === undefined || value === null) {
    return { valid: false, error: `${fieldName} is required` };
  }
  const num = parseInt(String(value), 10);
  if (isNaN(num)) {
    return { valid: false, error: `${fieldName} must be a number` };
  }
  if (num < min) {
    return { valid: false, error: `${fieldName} must be at least ${min}` };
  }
  if (max !== undefined && num > max) {
    return { valid: false, error: `${fieldName} must be at most ${max}` };
  }
  return { valid: true, value: num };
}

module.exports = {
  validateRequiredString,
  validateOptionalString,
  validatePositiveInteger,
};
