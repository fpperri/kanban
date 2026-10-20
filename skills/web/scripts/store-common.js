'use strict';
// What the stores that answer the page share. StatusError is a refusal that carries its HTTP
// status: the group, logbook, scratchpad and settings stores throw it, and the server answers
// every one with its status and message from a single catch. posix writes a path with `/`.
const path = require('path');

class StatusError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'StatusError';
    this.status = status;
  }
}

const posix = (p) => p.split(path.sep).join('/');

module.exports = { StatusError, posix };
