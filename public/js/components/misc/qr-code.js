// QR code for deposit addresses, generated locally (no third-party service
// ever sees the address).
import qrcodegen from '../../../vendor/qrcodegen.js';
import { h, svg } from '../../core/dom.js';

export function qrCode(text, { label } = {}) {
  const qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM);
  const border = 2;
  const size = qr.size + border * 2;
  const parts = [];
  for (let y = 0; y < qr.size; y += 1) {
    for (let x = 0; x < qr.size; x += 1) if (qr.getModule(x, y)) parts.push(`M${x + border},${y + border}h1v1h-1z`);
  }
  const image = svg('svg', { viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-label': label || text, 'shape-rendering': 'crispEdges' },
    svg('rect', { width: size, height: size, fill: '#ffffff' }),
    svg('path', { d: parts.join(''), fill: '#0d1412' }),
  );
  return h('div', { class: 'qr' }, image);
}
