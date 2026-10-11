// Uniform success envelope: { data, meta: { serverTime, ... } }.
// serverTime lets the client show "last updated" from the server clock.

export function sendData(res, data, { status = 200, meta } = {}) {
  res.status(status).json({ data, meta: { serverTime: new Date().toISOString(), ...(meta || {}) } });
}

export function sendCreated(res, data, meta) {
  sendData(res, data, { status: 201, meta });
}

export function sendNoContent(res) {
  res.status(204).end();
}
