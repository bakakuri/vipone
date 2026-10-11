// Vercel Function entry point: every /api/* request is rewritten here
// (see vercel.json). Static pages are served directly by Vercel's CDN.

import { createApp } from '../server/app.js';

const app = createApp();

export default app;
