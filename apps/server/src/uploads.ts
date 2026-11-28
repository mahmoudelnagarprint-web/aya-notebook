import { Hono } from 'hono';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as zlib from 'node:zlib';
import { getSupabaseAdmin, isSupabaseConfigured, publicUploadUrl } from '@ayatodoist/database';

/** Public Supabase Storage bucket used for every upload when Supabase is configured. */
export const SUPABASE_UPLOAD_BUCKET = 'uploads';

const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const IMAGE_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
const TEXT_EXT: Record<string, string> = {
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/x-markdown': '.md',
  'application/json': '.json',
  'text/csv': '.csv',
  'text/html': '.txt',
  'application/xml': '.txt',
  'text/xml': '.txt',
  'application/javascript': '.txt',
  'text/javascript': '.txt',
  'application/typescript': '.txt',
};
const EXT_TO_MIME: Record<string, string> = {
  ...Object.fromEntries(Object.entries(IMAGE_EXT).map(([mime, ext]) => [ext, mime])),
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.pdf': 'application/pdf',
};
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_TEXT = 60_000;

export function uploadsDir(appDir = process.cwd()): string {
  const dir = path.resolve(appDir, 'data', 'uploads');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* read-only filesystem (serverless): only Supabase Storage is usable there */
  }
  return dir;
}

function baseDir(appDir: string) {
  return uploadsDir(appDir);
}

interface StoredUpload {
  url: string;
  error?: string;
}

/**
 * Persists one upload: Supabase Storage when SUPABASE_URL is set, local disk
 * otherwise. Returns the public URL the client should use.
 */
async function storeUpload(dir: string, filename: string, buf: Buffer, mime: string, size: number): Promise<StoredUpload> {
  if (isSupabaseConfigured()) {
    const client = getSupabaseAdmin();
    const { error } = await client.storage.from(SUPABASE_UPLOAD_BUCKET).upload(filename, buf, {
      contentType: mime,
      cacheControl: '31536000',
      upsert: true,
    });
    if (error) return { url: '', error: error.message };

    const url = publicUploadUrl(filename) ?? `/api/v1/uploads/${filename}`;
    // Best-effort bookkeeping row for external agents; the file itself already
    // lives in Storage, so a missing `uploads` table must not fail the request.
    const { error: recordError } = await client.from('uploads').insert({
      id: filename,
      filename,
      content_type: mime,
      size,
      url,
    });
    if (recordError) console.warn('[uploads] could not record row:', recordError.message);
    return { url };
  }

  fs.writeFileSync(path.join(dir, filename), buf);
  return { url: `/api/v1/uploads/${filename}` };
}

interface UploadRequest {
  req: {
    header?: (name: string) => string | undefined;
    json?: () => Promise<unknown>;
    raw: {
      headers: { get: (name: string) => string | null };
      formData?: () => Promise<FormData>;
      arrayBuffer?: () => Promise<ArrayBuffer>;
    };
  };
}

function firstHeaderValue(c: UploadRequest): string {
  const fromRaw = c.req.raw?.headers?.get?.('content-type') ?? '';
  if (fromRaw) return fromRaw;
  return c.req.header?.('content-type') ?? '';
}

interface BufferedPayload {
  buf: Buffer;
  /** The file's own content type when it can be trusted (form field / raw body). */
  declaredMime: string | null;
}

async function bufferFrom(c: UploadRequest): Promise<BufferedPayload | null> {
  const contentType = firstHeaderValue(c).toLowerCase();

  try {
    if (contentType.startsWith('application/json')) {
      const body = await c.req.json?.();
      const payload = body && typeof body === 'object' ? body : null;
      const data = payload && 'data' in payload ? (payload as { data?: string }).data : null;
      if (typeof data !== 'string') return null;
      const headerEnd = data.indexOf(',');
      const raw = headerEnd >= 0 ? data.slice(headerEnd + 1) : data;
      const bin = Buffer.from(raw, 'base64');
      if (bin.length === 0 || bin.length > MAX_BYTES) return null;
      // A JSON base64 wrapper says nothing about the file type — only sniffing counts.
      return { buf: bin, declaredMime: null };
    }
  } catch {
    return null;
  }

  try {
    if (typeof c.req.raw?.formData === 'function') {
      const formData = await c.req.raw.formData();
      const file = (formData && formData.get('file')) ?? null;
      if (file && typeof file === 'object' && 'arrayBuffer' in file) {
        const buf = Buffer.from(await file.arrayBuffer());
        if (buf.length === 0 || buf.length > MAX_BYTES) return null;
        const declared = typeof (file as { type?: unknown }).type === 'string' ? String((file as { type?: string }).type) : null;
        return { buf, declaredMime: declared && declared !== 'application/octet-stream' ? declared : null };
      }
    }
  } catch {
    return null;
  }

  try {
    if (typeof c.req.raw?.arrayBuffer === 'function') {
      const buf = Buffer.from(await c.req.raw.arrayBuffer());
      if (buf.length === 0 || buf.length > MAX_BYTES) return null;
      return { buf, declaredMime: contentType.split(';')[0] ?? null };
    }
  } catch {
    return null;
  }

  return null;
}

function mimeForImage(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  const head = buf.slice(0, 4);
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) {
    if (buf.length >= 12 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  }
  return null;
}

function isPdf(buf: Buffer): boolean {
  return buf.subarray(0, 5).toString('latin1') === '%PDF-';
}

/**
 * Dependency-free PDF text extraction: inflates FlateDecode content streams and
 * pulls text out of Tj/TJ operators. Enough for notes, invoices and exported docs.
 */
export function extractPdfText(buf: Buffer): string {
  const raw = buf.toString('latin1');
  const chunks: string[] = [raw];
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    const body = match[1];
    if (!body) continue;
    try {
      chunks.push(zlib.inflateSync(Buffer.from(body, 'latin1')).toString('latin1'));
    } catch {
      /* stream may be uncompressed or use another filter */
    }
  }
  const texts: string[] = [];
  for (const chunk of chunks) {
    for (const match of chunk.matchAll(/\(((?:\\.|[^()\\])*)\)\s*Tj/g)) {
      texts.push(unescapePdf(match[1] ?? ''));
    }
    for (const match of chunk.matchAll(/\[((?:[^\][]|\\.)*)\]\s*TJ/g)) {
      const parts = [...(match[1] ?? '').matchAll(/\(((?:\\.|[^()\\])*)\)/g)].map((part) => unescapePdf(part[1] ?? ''));
      if (parts.length) texts.push(parts.join(''));
    }
  }
  return texts.join(' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

function unescapePdf(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\\t/g, '\t')
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\(\d{1,3})/g, (_all, code: string) => String.fromCharCode(Number.parseInt(code, 8)));
}

function decodeText(buf: Buffer): string {
  return buf.toString('utf8').replace(/\u0000/g, '').slice(0, MAX_TEXT);
}

export function readUploadAsDataUrl(filename: string, appDir = process.cwd()): string | null {
  try {
    const target = path.join(baseDir(appDir), path.basename(filename));
    if (!fs.existsSync(target)) return null;
    const buf = fs.readFileSync(target);
    const mime = mimeForImage(buf);
    if (!mime) return null;
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

export function handleUploads(appDir?: string) {
  const dir = baseDir(appDir ?? process.cwd());
  const app = new Hono();

  app.post('/', async (c) => {
    const payload = await bufferFrom(c as unknown as UploadRequest);
    if (!payload) {
      return c.json({ ok: false, error: { code: 'validation', message: 'Invalid or missing file payload' } }, 400);
    }
    const buf = payload.buf;
    const imageMime = mimeForImage(buf);
    let mime: string | null = imageMime;
    if (!mime && isPdf(buf)) mime = 'application/pdf';
    if (!mime && payload.declaredMime) mime = TEXT_EXT[payload.declaredMime] ?? null;
    if (!mime) {
      return c.json(
        { ok: false, error: { code: 'validation', message: 'Unsupported image type or file. Allowed: png/jpeg/webp/gif, txt, md, json, csv, pdf' } },
        400,
      );
    }
    const ext = IMAGE_EXT[mime] ?? (mime === 'application/pdf' ? '.pdf' : TEXT_EXT[mime] ?? '.txt');
    const filename = crypto.randomUUID() + ext;

    const stored = await storeUpload(dir, filename, buf, mime, buf.length);
    if (stored.error) {
      return c.json({ ok: false, error: { code: 'upload-failed', message: stored.error } }, 502);
    }

    let text: string | undefined;
    let kind: 'image' | 'file' = 'file';
    if (IMAGE_MIME.includes(mime)) {
      kind = 'image';
    } else if (mime === 'application/pdf') {
      text = extractPdfText(buf);
    } else {
      text = decodeText(buf);
    }
    return c.json({
      ok: true,
      filename,
      content_type: mime,
      size: buf.length,
      kind,
      text,
      url: stored.url,
    });
  });

  app.get('/:filename', (c) => {
    const filename = c.req.param('filename');
    if (!filename) {
      return c.json({ ok: false, error: { code: 'validation', message: 'Filename required' } }, 400);
    }
    const safe = path.basename(filename);
    const ext = path.extname(safe).toLowerCase();
    const expectedMime = EXT_TO_MIME[ext] ?? null;
    if (!expectedMime) {
      return c.json({ ok: false, error: { code: 'not-found', message: 'Unknown filename' } }, 404);
    }
    // With Supabase Storage the bytes live in the public bucket: redirect there
    // instead of proxying them through the function.
    if (isSupabaseConfigured()) {
      const publicUrl = publicUploadUrl(safe);
      if (publicUrl) return c.redirect(publicUrl, 302);
    }

    const target = path.join(dir, safe);
    if (!fs.existsSync(target)) {
      return c.json({ ok: false, error: { code: 'not-found', message: 'File not found' } }, 404);
    }
    const stat = fs.statSync(target);
    return new Response(fs.readFileSync(target) as unknown as BodyInit, {
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Type': expectedMime,
        'Content-Length': String(stat.size),
      },
    });
  });

  app.delete('/:filename', async (c) => {
    const filename = c.req.param('filename');
    if (!filename) {
      return c.json({ ok: false, error: { code: 'validation', message: 'Filename required' } }, 400);
    }
    const safe = path.basename(filename);
    const ext = path.extname(safe).toLowerCase();
    if (!EXT_TO_MIME[ext]) {
      return c.json({ ok: false, error: { code: 'not-found', message: 'Unknown filename' } }, 404);
    }
    if (isSupabaseConfigured()) {
      const client = getSupabaseAdmin();
      const { error } = await client.storage.from(SUPABASE_UPLOAD_BUCKET).remove([safe]);
      if (error) {
        return c.json({ ok: false, error: { code: 'upload-failed', message: error.message } }, 502);
      }
      return c.json({ ok: true });
    }

    const target = path.join(dir, safe);
    if (!fs.existsSync(target)) {
      return c.json({ ok: false, error: { code: 'not-found', message: 'File not found' } }, 404);
    }
    fs.unlinkSync(target);
    return c.json({ ok: true });
  });

  return app;
}
