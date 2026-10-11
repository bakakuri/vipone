import { sendData } from '../../core/respond.js';
import * as investments from '../investments/investments.service.js';
import * as service from './public.service.js';

// Short shared caching for anonymous reference data.
const cache = (res, seconds) => res.setHeader('Cache-Control', `public, max-age=${seconds}, stale-while-revalidate=${seconds * 4}`);

export async function config(req, res) {
  cache(res, 60);
  sendData(res, await service.getPublicConfig());
}

export async function assets(req, res) {
  cache(res, 300);
  sendData(res, await service.getAssets());
}

export async function products(req, res) {
  cache(res, 60);
  sendData(res, await investments.listProducts());
}

export async function product(req, res) {
  cache(res, 60);
  sendData(res, await investments.getProductBySlug(req.params.slug));
}

export async function legal(req, res) {
  cache(res, 600);
  sendData(res, await service.getLegalDocuments());
}

export async function stats(req, res) {
  cache(res, 300);
  sendData(res, await service.getStats());
}
