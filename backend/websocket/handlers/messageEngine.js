'use strict';

const sendMessage = require('./sendMessage');
const deliveredAck = require('./deliveredAck');
const readAck = require('./readAck');
const reconnect = require('./reconnect');
const { getOrderedMessagesForDelivery, getMissedMessages } = require('./messageQueries');
const wsMessageService = require('../services/message.service');
const { MessageState, VALID_TRANSITIONS } = require('../../models/message.state');

/**
 * Get message state (delegates to service)
 * @param {string} messageId - Message identifier
 * @returns {Object|null} Message data or null
 */
function getMessageState(messageId) {
  return wsMessageService.getMessageState(messageId) || null;
}

/**
 * Clear message store (for testing; delegates to service)
 */
function clearStore() {
  wsMessageService.clearMessageMemoryStore();
}

module.exports = {
  handleMessageSend: sendMessage.handleMessageSend,
  handleMessageRead: readAck.handleMessageRead,
  handleMessageReadConfirm: readAck.handleMessageReadConfirm,
  handleMessageDeliveredConfirm: deliveredAck.handleMessageDeliveredConfirm,
  handleMessageReplay: reconnect.handleMessageReplay,
  handleStateSync: reconnect.handleStateSync,
  handleClientAck: readAck.handleClientAck,
  getMessageState,
  getMissedMessages,
  getOrderedMessagesForDelivery,
  clearStore,
  MessageState,
  VALID_TRANSITIONS,
};
