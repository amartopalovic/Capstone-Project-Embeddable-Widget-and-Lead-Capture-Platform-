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
export * from './auth.js';
export * from './workspace.js';
export * from './contact.js';
export * from './delivery.js';
export * from './analytics.js';
export * from './privacy.js';
export * from './demo.js';
export * from './widget.js';
export * from './widget-rules.js';
