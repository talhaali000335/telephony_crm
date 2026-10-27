// Express 4 does not catch errors from async handlers. This wrapper forwards them
// to the error middleware in server.js.
export const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
