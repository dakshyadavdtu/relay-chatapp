/**
 * message.logic.js
 *
 * Domain service for messages: create and transition. Enforces invariants
 * via validator and machine. Returns new message objects (immutability).
 * Orchestrates: validate → dedupe → assign sequence → state transition → serialize (optional).
 * No DB, WebSocket, timers, or retries.
 */

const machine = require('./message.machine.js');
const validator = require('./message.validator.js');

/**
 * @typedef {Object} DeduplicationStorage
 * @property {function(string, string): Promise<boolean>} hasMessage - Check if (conversationId, clientMsgId) exists
 * @property {function(string, string): Promise<void>} storeMessage - Store (conversationId, clientMsgId)
 */

/**
 * @typedef {Object} SequenceStorage
 * @property {function(string): Promise<number>} getNextSequence - Get next sequence for conversationId
 */

let deduplicationStorage = null;
let sequenceStorage = null;

/**
 * @param {DeduplicationStorage} storage
 */
function setDeduplicationStorage(storage) {
  deduplicationStorage = storage;
}

/**
 * @param {SequenceStorage} storage
 */
function setSequenceStorage(storage) {
  sequenceStorage = storage;
}

/**
 * @param {string} conversationId
 * @param {string} clientMsgId
 * @returns {Promise<boolean>}
 */
async function checkDuplicate(conversationId, clientMsgId) {
  if (!deduplicationStorage) {
    return false;
  }
  return await deduplicationStorage.hasMessage(conversationId, clientMsgId);
}

/**
 * @param {string} conversationId
 * @param {string} clientMsgId
 * @returns {Promise<void>}
 */
async function markAsSeen(conversationId, clientMsgId) {
  if (deduplicationStorage) {
    await deduplicationStorage.storeMessage(conversationId, clientMsgId);
  }
}

/**
 * @param {string} conversationId
 * @returns {Promise<number>}
 */
async function assignSequenceNumber(conversationId) {
  if (!sequenceStorage) {
    throw new Error('Sequence storage not configured');
  }
  return await sequenceStorage.getNextSequence(conversationId);
}

/**
 * @param {{ clientMsgId: string, conversationId: string, payload: unknown, protocolVersion: number, senderId?: string, receiverId?: string, messageId?: string, createdAt?: number, updatedAt?: number }} payload
 * @returns {Promise<{ clientMsgId: string, conversationId: string, payload: unknown, protocolVersion: number, messageId: string, senderId?: string, receiverId?: string, state: string, sequenceNumber: number, createdAt?: number, updatedAt?: number }>}
 * @throws {InvalidMessageError|InvalidStateError}
 */
async function createMessage(payload) {
  const validationResult = validator.validateMessageSchema(payload);
  if (!validationResult.isValid) {
    throw validationResult.toError();
  }

  const isDuplicate = await checkDuplicate(payload.conversationId, payload.clientMsgId);
  if (isDuplicate) {
    throw new validator.InvalidMessageError('duplicate', `Message with clientMsgId "${payload.clientMsgId}" already exists in conversation "${payload.conversationId}"`);
  }

  const sequenceNumber = await assignSequenceNumber(payload.conversationId);
  await markAsSeen(payload.conversationId, payload.clientMsgId);

  const state = machine.getInitialState();
  const messageId = payload.messageId || generateMessageId();

  const message = {
    messageId,
    clientMsgId: payload.clientMsgId,
    conversationId: payload.conversationId,
    payload: payload.payload,
    protocolVersion: payload.protocolVersion,
    senderId: payload.senderId,
    receiverId: payload.receiverId,
    state,
    sequenceNumber,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
  };

  validator.validateMessageShape(message);
  return message;
}

/**
 * @returns {string}
 */
function generateMessageId() {
  const random1 = Math.random().toString(36).substring(2, 15);
  const random2 = Math.random().toString(36).substring(2, 15);
  const random3 = Math.random().toString(36).substring(2, 15);
  return `msg_${random1}_${random2}_${random3}`;
}

/**
 * @param {{ messageId: string, state: string, [key: string]: unknown }} message
 * @param {string} nextState
 * @returns {{ [key: string]: unknown }}
 * @throws {InvalidMessageError|InvalidStateError|InvalidTransitionError}
 */
function transitionMessage(message, nextState) {
  validator.validateMessageShape(message);
  try {
    machine.assertTransition(message.state, nextState);
  } catch (err) {
    throw new validator.InvalidTransitionError(message.state, nextState, err.message);
  }

  return {
    ...message,
    state: nextState,
  };
}

/**
 * @param {{ [key: string]: unknown }[]} messages
 * @returns {{ [key: string]: unknown }[]}
 */
function batchMessages(messages) {
  if (!Array.isArray(messages)) {
    throw new validator.InvalidMessageError('batch', 'messages must be an array');
  }

  const conversationMap = new Map();
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object' || !msg.conversationId) {
      continue;
    }
    const convId = String(msg.conversationId);
    if (!conversationMap.has(convId)) {
      conversationMap.set(convId, []);
    }
    conversationMap.get(convId).push(msg);
  }

  const batches = [];
  for (const [conversationId, msgs] of conversationMap) {
    msgs.sort((a, b) => {
      const seqA = a.sequenceNumber !== undefined ? Number(a.sequenceNumber) : -1;
      const seqB = b.sequenceNumber !== undefined ? Number(b.sequenceNumber) : -1;
      return seqA - seqB;
    });
    batches.push({
      conversationId,
      messages: msgs,
      count: msgs.length,
    });
  }

  return batches;
}

/**
 * @param {string} conversationId
 * @param {string} clientMsgId
 * @returns {Promise<boolean>}
 */
async function isDuplicate(conversationId, clientMsgId) {
  return await checkDuplicate(conversationId, clientMsgId);
}

let messagePackEnabled = false;

/**
 * @param {boolean} enabled
 */
function setMessagePackEnabled(enabled) {
  messagePackEnabled = enabled;
}

/**
 * @param {{ [key: string]: unknown }} message
 * @returns {Buffer|string}
 */
function serialize(message) {
  if (!messagePackEnabled) {
    return JSON.stringify(message);
  }
  return messagePackEncode(message);
}

/**
 * @param {Buffer|string} data
 * @returns {{ [key: string]: unknown }}
 */
function deserialize(data) {
  if (!messagePackEnabled) {
    return JSON.parse(typeof data === 'string' ? data : data.toString());
  }
  return messagePackDecode(data);
}

/**
 * @param {{ [key: string]: unknown }} message
 * @returns {Buffer}
 */
function messagePackEncode(message) {
  const json = JSON.stringify(message);
  const buffer = Buffer.from(json, 'utf8');
  return buffer;
}

/**
 * @param {Buffer|string} buffer
 * @returns {{ [key: string]: unknown }}
 */
function messagePackDecode(buffer) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer, 'utf8');
  const json = data.toString('utf8');
  return JSON.parse(json);
}

module.exports = {
  setDeduplicationStorage,
  setSequenceStorage,
  setMessagePackEnabled,
  createMessage,
  transitionMessage,
  batchMessages,
  isDuplicate,
  serialize,
  deserialize,
};
/**
 * message.logic.js
 *
 * Domain service for messages: create and transition. Enforces invariants
 * via validator and machine. Returns new message objects (immutability).
 * Orchestrates: validate → dedupe → assign sequence → state transition → serialize (optional).
 * No DB, WebSocket, timers, or retries.
 */

const machine = require('./message.machine.js');
const validator = require('./message.validator.js');

/**
 * @typedef {Object} DeduplicationStorage
 * @property {function(string, string): Promise<boolean>} hasMessage - Check if (conversationId, clientMsgId) exists
 * @property {function(string, string): Promise<void>} storeMessage - Store (conversationId, clientMsgId)
 */

/**
 * @typedef {Object} SequenceStorage
 * @property {function(string): Promise<number>} getNextSequence - Get next sequence for conversationId
 */

let deduplicationStorage = null;
let sequenceStorage = null;

/**
 * @param {DeduplicationStorage} storage
 */
function setDeduplicationStorage(storage) {
  deduplicationStorage = storage;
}

/**
 * @param {SequenceStorage} storage
 */
function setSequenceStorage(storage) {
  sequenceStorage = storage;
}

/**
 * @param {string} conversationId
 * @param {string} clientMsgId
 * @returns {Promise<boolean>}
 */
async function checkDuplicate(conversationId, clientMsgId) {
  if (!deduplicationStorage) {
    return false;
  }
  return await deduplicationStorage.hasMessage(conversationId, clientMsgId);
}

/**
 * @param {string} conversationId
 * @param {string} clientMsgId
 * @returns {Promise<void>}
 */
async function markAsSeen(conversationId, clientMsgId) {
  if (deduplicationStorage) {
    await deduplicationStorage.storeMessage(conversationId, clientMsgId);
  }
}

/**
 * @param {string} conversationId
 * @returns {Promise<number>}
 */
async function assignSequenceNumber(conversationId) {
  if (!sequenceStorage) {
    throw new Error('Sequence storage not configured');
  }
  return await sequenceStorage.getNextSequence(conversationId);
}

/**
 * @param {{ clientMsgId: string, conversationId: string, payload: unknown, protocolVersion: number, senderId?: string, receiverId?: string, messageId?: string, createdAt?: number, updatedAt?: number }} payload
 * @returns {Promise<{ clientMsgId: string, conversationId: string, payload: unknown, protocolVersion: number, messageId: string, senderId?: string, receiverId?: string, state: string, sequenceNumber: number, createdAt?: number, updatedAt?: number }>}
 * @throws {InvalidMessageError|InvalidStateError}
 */
async function createMessage(payload) {
  const validationResult = validator.validateMessageSchema(payload);
  if (!validationResult.isValid) {
    throw validationResult.toError();
  }

  const isDuplicate = await checkDuplicate(payload.conversationId, payload.clientMsgId);
  if (isDuplicate) {
    throw new validator.InvalidMessageError('duplicate', `Message with clientMsgId "${payload.clientMsgId}" already exists in conversation "${payload.conversationId}"`);
  }

  const sequenceNumber = await assignSequenceNumber(payload.conversationId);
  await markAsSeen(payload.conversationId, payload.clientMsgId);

  const state = machine.getInitialState();
  const messageId = payload.messageId || generateMessageId();

  const message = {
    messageId,
    clientMsgId: payload.clientMsgId,
    conversationId: payload.conversationId,
    payload: payload.payload,
    protocolVersion: payload.protocolVersion,
    senderId: payload.senderId,
    receiverId: payload.receiverId,
    state,
    sequenceNumber,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
  };

  validator.validateMessageShape(message);
  return message;
}

/**
 * @returns {string}
 */
function generateMessageId() {
  const random1 = Math.random().toString(36).substring(2, 15);
  const random2 = Math.random().toString(36).substring(2, 15);
  const random3 = Math.random().toString(36).substring(2, 15);
  return `msg_${random1}_${random2}_${random3}`;
}

/**
 * @param {{ messageId: string, state: string, [key: string]: unknown }} message
 * @param {string} nextState
 * @returns {{ [key: string]: unknown }}
 * @throws {InvalidMessageError|InvalidStateError|InvalidTransitionError}
 */
function transitionMessage(message, nextState) {
  validator.validateMessageShape(message);
  try {
    machine.assertTransition(message.state, nextState);
  } catch (err) {
    throw new validator.InvalidTransitionError(message.state, nextState, err.message);
  }

  return {
    ...message,
    state: nextState,
  };
}

/**
 * @param {{ [key: string]: unknown }[]} messages
 * @returns {{ [key: string]: unknown }[]}
 */
function batchMessages(messages) {
  if (!Array.isArray(messages)) {
    throw new validator.InvalidMessageError('batch', 'messages must be an array');
  }

  const conversationMap = new Map();
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object' || !msg.conversationId) {
      continue;
    }
    const convId = String(msg.conversationId);
    if (!conversationMap.has(convId)) {
      conversationMap.set(convId, []);
    }
    conversationMap.get(convId).push(msg);
  }

  const batches = [];
  for (const [conversationId, msgs] of conversationMap) {
    msgs.sort((a, b) => {
      const seqA = a.sequenceNumber !== undefined ? Number(a.sequenceNumber) : -1;
      const seqB = b.sequenceNumber !== undefined ? Number(b.sequenceNumber) : -1;
      return seqA - seqB;
    });
    batches.push({
      conversationId,
      messages: msgs,
      count: msgs.length,
    });
  }

  return batches;
}

/**
 * @param {string} conversationId
 * @param {string} clientMsgId
 * @returns {Promise<boolean>}
 */
async function isDuplicate(conversationId, clientMsgId) {
  return await checkDuplicate(conversationId, clientMsgId);
}

let messagePackEnabled = false;

/**
 * @param {boolean} enabled
 */
function setMessagePackEnabled(enabled) {
  messagePackEnabled = enabled;
}

/**
 * @param {{ [key: string]: unknown }} message
 * @returns {Buffer|string}
 */
function serialize(message) {
  if (!messagePackEnabled) {
    return JSON.stringify(message);
  }
  return messagePackEncode(message);
}

/**
 * @param {Buffer|string} data
 * @returns {{ [key: string]: unknown }}
 */
function deserialize(data) {
  if (!messagePackEnabled) {
    return JSON.parse(typeof data === 'string' ? data : data.toString());
  }
  return messagePackDecode(data);
}

/**
 * @param {{ [key: string]: unknown }} message
 * @returns {Buffer}
 */
function messagePackEncode(message) {
  const json = JSON.stringify(message);
  const buffer = Buffer.from(json, 'utf8');
  return buffer;
}

/**
 * @param {Buffer|string} buffer
 * @returns {{ [key: string]: unknown }}
 */
function messagePackDecode(buffer) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer, 'utf8');
  const json = data.toString('utf8');
  return JSON.parse(json);
}

module.exports = {
  setDeduplicationStorage,
  setSequenceStorage,
  setMessagePackEnabled,
  createMessage,
  transitionMessage,
  batchMessages,
  isDuplicate,
  serialize,
  deserialize,
};
