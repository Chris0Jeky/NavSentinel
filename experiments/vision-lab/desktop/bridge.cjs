'use strict';

// The desktop renderer can invoke this fixed broker vocabulary only. Tokens and
// transport stay in the main process; this is not a general HTTP bridge.
const methods = Object.freeze({
  '/api/health': 'GET', '/api/state': 'GET',
  '/api/request': 'POST', '/api/approve': 'POST',
  '/api/consume': 'POST', '/api/revoke': 'POST', '/api/scenario': 'POST'
});

function validateRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      !Object.hasOwn(methods, input.path) || methods[input.path] !== input.method ||
      Object.keys(input).some(key => !['path', 'method', 'body'].includes(key))) {
    throw new Error('Unsupported desktop operation');
  }
  if (input.method === 'GET' && input.body !== undefined) throw new Error('GET cannot carry a body');
  if (input.body !== undefined && (!input.body || typeof input.body !== 'object' || Array.isArray(input.body))) {
    throw new Error('Expected an object body');
  }
  const body = input.body === undefined ? undefined : JSON.stringify(input.body);
  if (body && Buffer.byteLength(body) > 16384) throw new Error('Message exceeds IPC budget');
  return {path: input.path, method: input.method, body};
}

module.exports = {validateRequest};
