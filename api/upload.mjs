/* Media uploads for the admin panel, backed by Vercel Blob.
   Uses the client-upload flow (browser PUTs straight to blob storage) so
   large videos are not limited by the 4.5MB serverless body cap.
   Requires the BLOB_READ_WRITE_TOKEN env var (auto-injected once a Blob
   store is created in the Vercel dashboard and connected to the project). */

import { handleUpload } from '@vercel/blob/client';
import { del } from '@vercel/blob';

const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif',
  'video/mp4', 'video/quicktime', 'video/webm',
];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({ error: 'blob store not configured' });
  }

  const body = req.body || {};
  const headerKey = req.headers['x-admin-key'] || '';
  const isAdmin = (k) => Boolean(process.env.ADMIN_KEY) && k === process.env.ADMIN_KEY;

  // deletion of a replaced blob
  if (body.type === 'delete') {
    if (!isAdmin(headerKey)) return res.status(401).json({ error: 'unauthorized' });
    if (typeof body.url !== 'string' || !/\.blob\.vercel-storage\.com\//.test(body.url)) {
      return res.status(400).json({ error: 'bad url' });
    }
    try { await del(body.url); } catch { /* already gone is fine */ }
    return res.json({ ok: true });
  }

  // client-upload token generation + completion callback
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let payload = {};
        try { payload = JSON.parse(clientPayload || '{}'); } catch { /* ignore */ }
        if (!isAdmin(headerKey || payload.adminKey || '')) throw new Error('unauthorized');
        if (!/^media\/[\w.-]+$/.test(pathname)) throw new Error('bad path');
        return {
          allowedContentTypes: ALLOWED_TYPES,
          maximumSizeInBytes: 300 * 1024 * 1024,
          addRandomSuffix: false,
        };
      },
      onUploadCompleted: async () => { /* the admin page saves the URL itself */ },
    });
    return res.json(result);
  } catch (e) {
    return res.status(400).json({ error: String((e && e.message) || e) });
  }
}
