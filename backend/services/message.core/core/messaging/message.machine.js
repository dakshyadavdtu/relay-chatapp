/**
 * message.machine.js
 *
 * Single source of truth for message state transitions.
 * Defines allowed states and legal transitions. No side effects, no mutation,
 * no async, no external imports. Pure deterministic FSM.
 */

const STATES = Object.freeze(['CREATED', 'ACCEPTED', 'PERSISTED']);

const TRANSITIONS = Object.freeze({
  CREATED: 'ACCEPTED',
  ACCEPTED: 'PERSISTED',
});

/**
 * @param {string} state
 * @returns {boolean}
 */
function isValidState(state) {
  return typeof state === 'string' && STATES.includes(state);
}

/**
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
function isValidTransition(from, to) {
  if (!isValidState(from) || !isValidState(to)) return false;
  return TRANSITIONS[from] === to;
}

/**
 * @param {string} from
 * @param {string} to
 * @throws {Error} when transition is invalid
 */
function assertTransition(from, to) {
  if (!isValidTransition(from, to)) {
    const allowed = Object.entries(TRANSITIONS).map(([f, t]) => f + '->' + t).join(', ');
    throw new Error('Invalid transition: "' + from + '" -> "' + to + '". Allowed: ' + allowed + '.');
  }
}

/**
 * @returns {string}
 */
function getInitialState() {
  return 'CREATED';
}

module.exports = {
  STATES,
  TRANSITIONS,
  isValidState,
  isValidTransition,
  assertTransition,
  getInitialState,
};
/**
 * message.machine.js
 *
 * Single source of truth for message state transitions.
 * Defines allowed states and legal transitions. No side effects, no mutation,
 * no async, no external imports. Pure deterministic FSM.
 */

const STATES = Object.freeze(['CREATED', 'ACCEPTED', 'PERSISTED']);

const TRANSITIONS = Object.freeze({
  CREATED: 'ACCEPTED',
  ACCEPTED: 'PERSISTED',
});

/**
 * @param {string} state
 * @returns {boolean}
 */
function isValidState(state) {
  return typeof state === 'string' && STATES.includes(state);
}

/**
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
function isValidTransition(from, to) {
  if (!isValidState(from) || !isValidState(to)) return false;
  return TRANSITIONS[from] === to;
}

/**
 * @param {string} from
 * @param {string} to
 * @throws {Error} when transition is invalid
 */
function assertTransition(from, to) {
  if (!isValidTransition(from, to)) {
    const allowed = Object.entries(TRANSITIONS).map(([f, t]) => f + '->' + t).join(', ');
    throw new Error('Invalid transition: "' + from + '" -> "' + to + '". Allowed: ' + allowed + '.');
  }
}

/**
 * @returns {string}
 */
function getInitialState() {
  return 'CREATED';
}

module.exports = {
  STATES,
  TRANSITIONS,
  isValidState,
  isValidTransition,
  assertTransition,
  getInitialState,
};
