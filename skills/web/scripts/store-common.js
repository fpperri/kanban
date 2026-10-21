'use strict';
// What the stores that answer the page share. StatusError is a refusal that carries its HTTP
// status: the group, logbook, scratchpad and settings stores throw it, and the server answers
// every one with its status and message from a single catch. posix writes a path with `/`.
const path = require('path');
const crypto = require('crypto');

class StatusError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'StatusError';
    this.status = status;
  }
}

const posix = (p) => p.split(path.sep).join('/');

// A short version of a text, for a change that names the text it read (a 409 when it has changed since).
const versionOf = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

module.exports = { StatusError, posix, versionOf };
