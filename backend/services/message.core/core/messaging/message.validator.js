/**
 * message.validator.js
 *
 * Validates message shape and invariants. Uses message.machine for state
 * validity. Throws descriptive Error subclasses. Pure validation only;
 * does not modify the message.
 */

const machine = require('./message.machine.js');

class InvalidStateError extends Error {
  constructor(state, message = 'Invalid message state') {
    super(message + ': "' + state + '"');
    this.name = 'InvalidStateError';
    this.state = state;
  }
}

class InvalidTransitionError extends Error {
  constructor(from, to, message = 'Invalid state transition') {
    super(message + ': "' + from + '" -> "' + to + '"');
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.to = to;
  }
}

class InvalidMessageError extends Error {
  constructor(reason, message) {
    super(message || reason);
    this.name = 'InvalidMessageError';
    this.reason = reason;
  }
}

class ValidationError extends Error {
  constructor(field, reason, value) {
    super(`Validation failed for ${field}: ${reason}`);
    this.name = 'ValidationError';
    this.field = field;
    this.reason = reason;
    this.value = value;
  }
}

class ValidationResult {
  constructor() {
    this.errors = [];
    this.isValid = true;
  }

  addError(field, reason, value) {
    this.errors.push({ field, reason, value });
    this.isValid = false;
  }

  toError() {
    if (this.isValid) return null;
    const err = new InvalidMessageError('validation', 'Message validation failed');
    err.validationErrors = this.errors;
    return err;
  }
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isSafeNonNegativeInteger(value) {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    Number.isSafeInteger(value)
  );
}

const CLIENT_MSG_ID_MAX_LENGTH = 128;
const CONVERSATION_ID_MAX_LENGTH = 256;
const PAYLOAD_MAX_SIZE = 64 * 1024;
const PROTOCOL_VERSION = 1;

/**
 * @param {unknown} value
 * @param {number} maxLength
 * @returns {boolean}
 */
function isBoundedString(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isValidPayload(value) {
  if (typeof value === 'string') {
    return value.length <= PAYLOAD_MAX_SIZE;
  }
  if (typeof value === 'object' && value !== null) {
    try {
      const json = JSON.stringify(value);
      return json.length <= PAYLOAD_MAX_SIZE;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * @param {unknown} msg
 * @throws {InvalidMessageError}
 */
function validateMessageShape(msg) {
  if (msg === null || typeof msg !== 'object') {
    throw new InvalidMessageError('message must be an object', 'Invalid message: not an object');
  }

  if (msg.messageId !== undefined && !isNonEmptyString(msg.messageId)) {
    throw new InvalidMessageError('messageId', 'Invalid message: messageId must be a non-empty string if provided');
  }

  if (!isNonEmptyString(msg.senderId)) {
    throw new InvalidMessageError('senderId', 'Invalid message: senderId must be a non-empty string');
  }

  if (!isNonEmptyString(msg.receiverId)) {
    throw new InvalidMessageError('receiverId', 'Invalid message: receiverId must be a non-empty string');
  }

  if (msg.senderId === msg.receiverId) {
    throw new InvalidMessageError('senderId !== receiverId', 'Invalid message: senderId and receiverId must differ');
  }

  if (msg.content !== undefined && !isNonEmptyString(msg.content)) {
    throw new InvalidMessageError('content', 'Invalid message: content must be a non-empty string if provided');
  }

  if (msg.payload !== undefined && !isValidPayload(msg.payload)) {
    throw new InvalidMessageError('payload', `Invalid message: payload invalid type or exceeds max size ${PAYLOAD_MAX_SIZE}`);
  }

  if (!machine.isValidState(msg.state)) {
    throw new InvalidStateError(msg.state, 'Invalid message state');
  }

  const createdAt = msg.createdAt;
  const updatedAt = msg.updatedAt;

  if (createdAt !== undefined && !isSafeNonNegativeInteger(createdAt)) {
    throw new InvalidMessageError('createdAt', 'Invalid message: createdAt must be a non-negative integer');
  }

  if (updatedAt !== undefined && !isSafeNonNegativeInteger(updatedAt)) {
    throw new InvalidMessageError('updatedAt', 'Invalid message: updatedAt must be a non-negative integer');
  }

  if (
    createdAt !== undefined &&
    updatedAt !== undefined &&
    updatedAt < createdAt
  ) {
    throw new InvalidMessageError(
      'timestamps',
      'Invalid message: updatedAt must be >= createdAt (monotonic timestamps)'
    );
  }
}

/**
 * @param {string} from
 * @param {string} to
 * @throws {InvalidStateError|InvalidTransitionError}
 */
function validateTransition(from, to) {
  if (!machine.isValidState(from)) {
    throw new InvalidStateError(from);
  }
  if (!machine.isValidState(to)) {
    throw new InvalidStateError(to);
  }
  if (!machine.isValidTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

/**
 * @param {unknown} msg
 * @returns {ValidationResult}
 */
function validateMessageSchema(msg) {
  const result = new ValidationResult();

  if (msg === null || typeof msg !== 'object') {
    result.addError('message', 'must be an object', msg);
    return result;
  }

  if (!isNonEmptyString(msg.clientMsgId)) {
    result.addError('clientMsgId', 'required non-empty string', msg.clientMsgId);
  } else if (msg.clientMsgId.length > CLIENT_MSG_ID_MAX_LENGTH) {
    result.addError('clientMsgId', `exceeds max length ${CLIENT_MSG_ID_MAX_LENGTH}`, msg.clientMsgId);
  }

  if (!isNonEmptyString(msg.conversationId)) {
    result.addError('conversationId', 'required non-empty string', msg.conversationId);
  } else if (msg.conversationId.length > CONVERSATION_ID_MAX_LENGTH) {
    result.addError('conversationId', `exceeds max length ${CONVERSATION_ID_MAX_LENGTH}`, msg.conversationId);
  }

  if (msg.payload === undefined || msg.payload === null) {
    result.addError('payload', 'required', msg.payload);
  } else if (!isValidPayload(msg.payload)) {
    result.addError('payload', `invalid type or exceeds max size ${PAYLOAD_MAX_SIZE}`, typeof msg.payload);
  }

  if (msg.protocolVersion === undefined || msg.protocolVersion === null) {
    result.addError('protocolVersion', 'required', msg.protocolVersion);
  } else if (!isSafeNonNegativeInteger(msg.protocolVersion) || msg.protocolVersion !== PROTOCOL_VERSION) {
    result.addError('protocolVersion', `must be ${PROTOCOL_VERSION}`, msg.protocolVersion);
  }

  if (msg.messageId !== undefined && !isNonEmptyString(msg.messageId)) {
    result.addError('messageId', 'must be non-empty string if provided', msg.messageId);
  }

  if (msg.senderId !== undefined && !isNonEmptyString(msg.senderId)) {
    result.addError('senderId', 'must be non-empty string if provided', msg.senderId);
  }

  if (msg.receiverId !== undefined && !isNonEmptyString(msg.receiverId)) {
    result.addError('receiverId', 'must be non-empty string if provided', msg.receiverId);
  }

  if (msg.senderId !== undefined && msg.receiverId !== undefined && msg.senderId === msg.receiverId) {
    result.addError('senderId/receiverId', 'must differ', { senderId: msg.senderId, receiverId: msg.receiverId });
  }

  if (msg.state !== undefined && !machine.isValidState(msg.state)) {
    result.addError('state', 'invalid state', msg.state);
  }

  if (msg.sequenceNumber !== undefined && !isSafeNonNegativeInteger(msg.sequenceNumber)) {
    result.addError('sequenceNumber', 'must be non-negative integer if provided', msg.sequenceNumber);
  }

  if (msg.createdAt !== undefined && !isSafeNonNegativeInteger(msg.createdAt)) {
    result.addError('createdAt', 'must be non-negative integer if provided', msg.createdAt);
  }

  if (msg.updatedAt !== undefined && !isSafeNonNegativeInteger(msg.updatedAt)) {
    result.addError('updatedAt', 'must be non-negative integer if provided', msg.updatedAt);
  }

  if (
    msg.createdAt !== undefined &&
    msg.updatedAt !== undefined &&
    msg.updatedAt < msg.createdAt
  ) {
    result.addError('timestamps', 'updatedAt must be >= createdAt', { createdAt: msg.createdAt, updatedAt: msg.updatedAt });
  }

  return result;
}

module.exports = {
  InvalidStateError,
  InvalidTransitionError,
  InvalidMessageError,
  ValidationError,
  ValidationResult,
  CLIENT_MSG_ID_MAX_LENGTH,
  CONVERSATION_ID_MAX_LENGTH,
  PAYLOAD_MAX_SIZE,
  PROTOCOL_VERSION,
  validateMessageShape,
  validateMessageSchema,
  validateTransition,
};
/**
 * message.validator.js
 *
 * Validates message shape and invariants. Uses message.machine for state
 * validity. Throws descriptive Error subclasses. Pure validation only;
 * does not modify the message.
 */

const machine = require('./message.machine.js');

class InvalidStateError extends Error {
  constructor(state, message = 'Invalid message state') {
    super(message + ': "' + state + '"');
    this.name = 'InvalidStateError';
    this.state = state;
  }
}

class InvalidTransitionError extends Error {
  constructor(from, to, message = 'Invalid state transition') {
    super(message + ': "' + from + '" -> "' + to + '"');
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.to = to;
  }
}

class InvalidMessageError extends Error {
  constructor(reason, message) {
    super(message || reason);
    this.name = 'InvalidMessageError';
    this.reason = reason;
  }
}

class ValidationError extends Error {
  constructor(field, reason, value) {
    super(`Validation failed for ${field}: ${reason}`);
    this.name = 'ValidationError';
    this.field = field;
    this.reason = reason;
    this.value = value;
  }
}

class ValidationResult {
  constructor() {
    this.errors = [];
    this.isValid = true;
  }

  addError(field, reason, value) {
    this.errors.push({ field, reason, value });
    this.isValid = false;
  }

  toError() {
    if (this.isValid) return null;
    const err = new InvalidMessageError('validation', 'Message validation failed');
    err.validationErrors = this.errors;
    return err;
  }
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isSafeNonNegativeInteger(value) {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    Number.isSafeInteger(value)
  );
}

const CLIENT_MSG_ID_MAX_LENGTH = 128;
const CONVERSATION_ID_MAX_LENGTH = 256;
const PAYLOAD_MAX_SIZE = 64 * 1024;
const PROTOCOL_VERSION = 1;

/**
 * @param {unknown} value
 * @param {number} maxLength
 * @returns {boolean}
 */
function isBoundedString(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isValidPayload(value) {
  if (typeof value === 'string') {
    return value.length <= PAYLOAD_MAX_SIZE;
  }
  if (typeof value === 'object' && value !== null) {
    try {
      const json = JSON.stringify(value);
      return json.length <= PAYLOAD_MAX_SIZE;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * @param {unknown} msg
 * @throws {InvalidMessageError}
 */
function validateMessageShape(msg) {
  if (msg === null || typeof msg !== 'object') {
    throw new InvalidMessageError('message must be an object', 'Invalid message: not an object');
  }

  if (msg.messageId !== undefined && !isNonEmptyString(msg.messageId)) {
    throw new InvalidMessageError('messageId', 'Invalid message: messageId must be a non-empty string if provided');
  }

  if (!isNonEmptyString(msg.senderId)) {
    throw new InvalidMessageError('senderId', 'Invalid message: senderId must be a non-empty string');
  }

  if (!isNonEmptyString(msg.receiverId)) {
    throw new InvalidMessageError('receiverId', 'Invalid message: receiverId must be a non-empty string');
  }

  if (msg.senderId === msg.receiverId) {
    throw new InvalidMessageError('senderId !== receiverId', 'Invalid message: senderId and receiverId must differ');
  }

  if (msg.content !== undefined && !isNonEmptyString(msg.content)) {
    throw new InvalidMessageError('content', 'Invalid message: content must be a non-empty string if provided');
  }

  if (msg.payload !== undefined && !isValidPayload(msg.payload)) {
    throw new InvalidMessageError('payload', `Invalid message: payload invalid type or exceeds max size ${PAYLOAD_MAX_SIZE}`);
  }

  if (!machine.isValidState(msg.state)) {
    throw new InvalidStateError(msg.state, 'Invalid message state');
  }

  const createdAt = msg.createdAt;
  const updatedAt = msg.updatedAt;

  if (createdAt !== undefined && !isSafeNonNegativeInteger(createdAt)) {
    throw new InvalidMessageError('createdAt', 'Invalid message: createdAt must be a non-negative integer');
  }

  if (updatedAt !== undefined && !isSafeNonNegativeInteger(updatedAt)) {
    throw new InvalidMessageError('updatedAt', 'Invalid message: updatedAt must be a non-negative integer');
  }

  if (
    createdAt !== undefined &&
    updatedAt !== undefined &&
    updatedAt < createdAt
  ) {
    throw new InvalidMessageError(
      'timestamps',
      'Invalid message: updatedAt must be >= createdAt (monotonic timestamps)'
    );
  }
}

/**
 * @param {string} from
 * @param {string} to
 * @throws {InvalidStateError|InvalidTransitionError}
 */
function validateTransition(from, to) {
  if (!machine.isValidState(from)) {
    throw new InvalidStateError(from);
  }
  if (!machine.isValidState(to)) {
    throw new InvalidStateError(to);
  }
  if (!machine.isValidTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

/**
 * @param {unknown} msg
 * @returns {ValidationResult}
 */
function validateMessageSchema(msg) {
  const result = new ValidationResult();

  if (msg === null || typeof msg !== 'object') {
    result.addError('message', 'must be an object', msg);
    return result;
  }

  if (!isNonEmptyString(msg.clientMsgId)) {
    result.addError('clientMsgId', 'required non-empty string', msg.clientMsgId);
  } else if (msg.clientMsgId.length > CLIENT_MSG_ID_MAX_LENGTH) {
    result.addError('clientMsgId', `exceeds max length ${CLIENT_MSG_ID_MAX_LENGTH}`, msg.clientMsgId);
  }

  if (!isNonEmptyString(msg.conversationId)) {
    result.addError('conversationId', 'required non-empty string', msg.conversationId);
  } else if (msg.conversationId.length > CONVERSATION_ID_MAX_LENGTH) {
    result.addError('conversationId', `exceeds max length ${CONVERSATION_ID_MAX_LENGTH}`, msg.conversationId);
  }

  if (msg.payload === undefined || msg.payload === null) {
    result.addError('payload', 'required', msg.payload);
  } else if (!isValidPayload(msg.payload)) {
    result.addError('payload', `invalid type or exceeds max size ${PAYLOAD_MAX_SIZE}`, typeof msg.payload);
  }

  if (msg.protocolVersion === undefined || msg.protocolVersion === null) {
    result.addError('protocolVersion', 'required', msg.protocolVersion);
  } else if (!isSafeNonNegativeInteger(msg.protocolVersion) || msg.protocolVersion !== PROTOCOL_VERSION) {
    result.addError('protocolVersion', `must be ${PROTOCOL_VERSION}`, msg.protocolVersion);
  }

  if (msg.messageId !== undefined && !isNonEmptyString(msg.messageId)) {
    result.addError('messageId', 'must be non-empty string if provided', msg.messageId);
  }

  if (msg.senderId !== undefined && !isNonEmptyString(msg.senderId)) {
    result.addError('senderId', 'must be non-empty string if provided', msg.senderId);
  }

  if (msg.receiverId !== undefined && !isNonEmptyString(msg.receiverId)) {
    result.addError('receiverId', 'must be non-empty string if provided', msg.receiverId);
  }

  if (msg.senderId !== undefined && msg.receiverId !== undefined && msg.senderId === msg.receiverId) {
    result.addError('senderId/receiverId', 'must differ', { senderId: msg.senderId, receiverId: msg.receiverId });
  }

  if (msg.state !== undefined && !machine.isValidState(msg.state)) {
    result.addError('state', 'invalid state', msg.state);
  }

  if (msg.sequenceNumber !== undefined && !isSafeNonNegativeInteger(msg.sequenceNumber)) {
    result.addError('sequenceNumber', 'must be non-negative integer if provided', msg.sequenceNumber);
  }

  if (msg.createdAt !== undefined && !isSafeNonNegativeInteger(msg.createdAt)) {
    result.addError('createdAt', 'must be non-negative integer if provided', msg.createdAt);
  }

  if (msg.updatedAt !== undefined && !isSafeNonNegativeInteger(msg.updatedAt)) {
    result.addError('updatedAt', 'must be non-negative integer if provided', msg.updatedAt);
  }

  if (msg.createdAt !== undefined && msg.updatedAt !== undefined && msg.updatedAt < msg.createdAt) {
    result.addError('timestamps', 'updatedAt must be >= createdAt', { createdAt: msg.createdAt, updatedAt: msg.updatedAt });
  }

  return result;
}

module.exports = {
  InvalidStateError,
  InvalidTransitionError,
  InvalidMessageError,
  ValidationError,
  ValidationResult,
  validateMessageShape,
  validateTransition,
  validateMessageSchema,
  isNonEmptyString,
  isSafeNonNegativeInteger,
  isBoundedString,
  isValidPayload,
  CLIENT_MSG_ID_MAX_LENGTH,
  CONVERSATION_ID_MAX_LENGTH,
  PAYLOAD_MAX_SIZE,
  PROTOCOL_VERSION,
};
