import { randomUUID } from 'node:crypto';
import { requestContext } from '../core/logger.js';

const VALID_ID = /^[A-Za-z0-9._-]{8,80}$/;

// Correlates logs and error responses with a request id (echoed in
// X-Request-Id). Vercel's own id is reused when present.
export function requestContextMiddleware() {
  return (req, res, next) => {
    const incoming = req.get('x-vercel-id') || req.get('x-request-id');
    req.id = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', req.id);
    requestContext.run({ requestId: req.id }, () => next());
  };
}
