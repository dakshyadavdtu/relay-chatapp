'use strict';

require('dotenv').config();
require('./env.validate')();

/** Frozen snapshot of validated env. Do not mutate. */
module.exports = Object.freeze({ ...process.env });
