/**
 * Shared contracts and validation schemas.
 *
 * Every workspace consumes API shapes from here so that error envelopes,
 * pagination, concurrency preconditions, and log records stay identical across
 * the server, the web application, and the widget runtime.
 */

export * from './api.js';
export * from './errors.js';
export * from './validation.js';
export * from './pagination.js';
export * from './concurrency.js';
export * from './logging.js';
