// Last middleware: converts every error into the uniform error envelope
//   { error: { code, message, details?, requestId } }
// Internal errors expose nothing but a generic code and the request id.

import { AppError } from '../core/errors.js';
import { mapDbError } from '../core/db-error-map.js';
import { logger } from '../core/logger.js';
import { reportError } from '../integrations/monitoring/error-reporter.js';

export function notFoundHandler() {
  return (req, res, next) => next(new AppError('route_not_found'));
}

export function errorHandler() {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    let error = mapDbError(err);
    if (error?.type === 'entity.parse.failed') error = new AppError('invalid_json');
    if (error?.type === 'entity.too.large') error = new AppError('payload_too_large');

    if (!(error instanceof AppError)) {
      reportError(error, { method: req.method, path: req.originalUrl.split('?')[0] });
      error = new AppError('internal_error');
    } else if (error.status >= 500) {
      logger.warn('request_failed', { code: error.code, status: error.status, path: req.originalUrl.split('?')[0] });
    }

    if (res.headersSent) return;
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.code.replace(/_/g, ' '),
        ...(error.details ? { details: error.details } : {}),
        requestId: req.id,
      },
    });
  };
}
