// Request validation with zod. Parsed values replace the raw input, so
// handlers only ever see validated data. Errors are returned as field paths
// with codes the client translates (errors:validation.<code>).

import { AppError } from '../core/errors.js';

function toDetails(issues) {
  return issues.map((issue) => ({
    path: issue.path.join('.'),
    code: issue.message && /^[a-z_]+$/.test(issue.message) ? issue.message : issue.code,
  }));
}

export function validate({ body, query, params } = {}) {
  return (req, res, next) => {
    const details = [];
    for (const [part, schema] of [['body', body], ['query', query], ['params', params]]) {
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (!result.success) {
        details.push(...toDetails(result.error.issues).map((d) => ({ ...d, path: `${part}.${d.path}`.replace(/\.$/, '') })));
      } else if (part === 'query') {
        // Express 5 exposes req.query as a getter; store parsed values separately.
        req.validQuery = result.data;
      } else {
        req[part] = result.data;
      }
    }
    if (details.length) return next(new AppError('validation_failed', { details }));
    next();
  };
}
