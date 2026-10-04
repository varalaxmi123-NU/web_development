import fs from 'node:fs';
import path from 'node:path';

/**
 * File storage with two backends:
 *  - "supabase": Supabase Storage (private bucket). Used when SUPABASE_URL and a
 *    secret key are set. Browsers upload straight to Storage with a short-lived
 *    signed URL, so files never pass through the (size-limited) serverless function.
 *  - "disk": a local folder, for running everything on your own machine.
 */

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
export const BUCKET = process.env.SUPABASE_BUCKET || 'attachments';

export function storageMode() {
  return SUPABASE_URL && SECRET_KEY ? 'supabase' : 'disk';
}

// On Vercel only /tmp is writable (and temporary): configure Supabase Storage there.
export const uploadDir = () => path.resolve(process.env.UPLOAD_DIR || (process.env.VERCEL ? '/tmp/teamflow-uploads' : './uploads'));

export function ensureUploadDir() {
  fs.mkdirSync(uploadDir(), { recursive: true });
}

let clientPromise = null;
async function supabase() {
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(async ({ createClient }) => {
      const client = createClient(SUPABASE_URL, SECRET_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      // Create the private bucket on first use (ignored if it already exists).
      const { error } = await client.storage.createBucket(BUCKET, { public: false });
      if (error && !/exist/i.test(error.message)) console.warn('Storage bucket:', error.message);
      return client;
    }).catch((err) => { clientPromise = null; throw err; });
  }
  return clientPromise;
}

/** Signed URL the browser can upload one file to (valid ~2h). */
export async function createSignedUpload(objectPath) {
  const sb = await supabase();
  const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(objectPath);
  if (error) throw new Error(`Storage: ${error.message}`);
  return data; // { signedUrl, token, path }
}

export async function objectExists(objectPath) {
  const sb = await supabase();
  const dir = path.posix.dirname(objectPath);
  const name = path.posix.basename(objectPath);
  const { data, error } = await sb.storage.from(BUCKET).list(dir, { search: name, limit: 5 });
  if (error) throw new Error(`Storage: ${error.message}`);
  return (data || []).find((f) => f.name === name) || null;
}

/** Short-lived download link for a private object. */
export async function signedDownloadUrl(objectPath, filename) {
  const sb = await supabase();
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(objectPath, 300, { download: filename || true });
  if (error) throw new Error(`Storage: ${error.message}`);
  return data.signedUrl;
}

/** Remove stored files for deleted attachments/tasks/projects. Never throws. */
export async function removeStoredFiles(rows = []) {
  const remote = rows.filter((r) => r.storage === 'supabase').map((r) => r.stored_name);
  const local = rows.filter((r) => r.storage !== 'supabase').map((r) => r.stored_name);
  for (const name of local) fs.unlink(path.join(uploadDir(), name), () => {});
  if (remote.length && storageMode() === 'supabase') {
    try {
      const sb = await supabase();
      await sb.storage.from(BUCKET).remove(remote);
    } catch (err) {
      console.warn('Storage cleanup:', err.message);
    }
  }
}
