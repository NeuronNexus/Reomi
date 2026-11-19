import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { AppError } from './errors';

export interface UploadTarget {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

/**
 * Where photos and videos live. Files go straight from the browser to storage with a short-lived
 * signed URL, so large videos never pass through the API, and every read is a signed URL too,
 * because community content is for members only.
 */
export interface MediaStorage {
  readonly kind: 'supabase' | 'local';
  createUpload(path: string, contentType: string): Promise<UploadTarget>;
  signDownloads(paths: readonly string[]): Promise<Map<string, string>>;
  ensureReady(): Promise<void>;
}

const DOWNLOAD_TTL_SECONDS = 60 * 60 * 6;

export class SupabaseStorage implements MediaStorage {
  readonly kind = 'supabase';
  private readonly base: string;

  constructor(
    supabaseUrl: string,
    private readonly secretKey: string,
    private readonly bucket: string,
  ) {
    this.base = `${supabaseUrl.replace(/\/$/, '')}/storage/v1`;
  }

  private async request<T>(path: string, body: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.base}${path}`, {
        method: 'POST',
        headers: {
          apikey: this.secretKey,
          authorization: `Bearer ${this.secretKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (cause) {
      throw new AppError(503, 'storage_unavailable', 'File storage is unreachable', {
        cause: String(cause),
      });
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new AppError(503, 'storage_unavailable', 'File storage rejected the request', {
        status: response.status,
        payload,
      });
    }
    return payload as T;
  }

  async ensureReady() {
    try {
      await this.request('/bucket', {
        id: this.bucket,
        name: this.bucket,
        public: false,
        file_size_limit: 50 * 1024 * 1024,
      });
    } catch (error) {
      // Already existing is the normal case after the first boot.
      const status = (error as AppError).details as
        { payload?: { statusCode?: string } } | undefined;
      if (status?.payload?.statusCode !== '409') throw error;
    }
  }

  async createUpload(path: string, contentType: string): Promise<UploadTarget> {
    const signed = await this.request<{ url: string }>(
      `/object/upload/sign/${this.bucket}/${path}`,
      {},
    );
    return {
      url: `${this.base}${signed.url}`,
      method: 'PUT',
      headers: { 'content-type': contentType, 'x-upsert': 'false' },
    };
  }

  async signDownloads(paths: readonly string[]) {
    const result = new Map<string, string>();
    if (paths.length === 0) return result;
    const unique = [...new Set(paths)];
    for (let index = 0; index < unique.length; index += 200) {
      const batch = unique.slice(index, index + 200);
      const signed = await this.request<{ path: string | null; signedURL: string | null }[]>(
        `/object/sign/${this.bucket}`,
        { expiresIn: DOWNLOAD_TTL_SECONDS, paths: batch },
      );
      for (const entry of signed) {
        if (entry.path && entry.signedURL) result.set(entry.path, `${this.base}${entry.signedURL}`);
      }
    }
    return result;
  }
}

/** Development and tests: files on disk, served by the API itself with HMAC-signed tokens. */
export class LocalStorage implements MediaStorage {
  readonly kind = 'local';

  constructor(
    private readonly root: string,
    private readonly publicUrl: string,
    private readonly secret: string,
  ) {}

  private sign(payload: object): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const mac = createHmac('sha256', this.secret).update(body).digest('base64url');
    return `${body}.${mac}`;
  }

  verify(
    token: string,
  ): { path: string; contentType: string; mode: 'put' | 'get'; exp: number } | null {
    const [body, mac] = token.split('.');
    if (!body || !mac) return null;
    const expected = createHmac('sha256', this.secret).update(body).digest();
    const given = Buffer.from(mac, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    if (typeof payload.path !== 'string' || payload.path.includes('..')) return null;
    return payload;
  }

  filePath(path: string): string {
    return resolve(this.root, path);
  }

  async ensureReady() {
    await mkdir(this.root, { recursive: true });
  }

  async createUpload(path: string, contentType: string): Promise<UploadTarget> {
    const token = this.sign({ path, contentType, mode: 'put', exp: Date.now() + 15 * 60_000 });
    return {
      url: `${this.publicUrl}/media/local/${token}`,
      method: 'PUT',
      headers: { 'content-type': contentType },
    };
  }

  async signDownloads(paths: readonly string[]) {
    const result = new Map<string, string>();
    for (const path of new Set(paths)) {
      const token = this.sign({
        path,
        contentType: '',
        mode: 'get',
        exp: Date.now() + DOWNLOAD_TTL_SECONDS * 1000,
      });
      result.set(path, `${this.publicUrl}/media/local/${token}`);
    }
    return result;
  }

  async write(path: string, data: Buffer, contentType: string) {
    const target = this.filePath(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
    await writeFile(`${target}.type`, contentType);
  }

  async read(path: string): Promise<{ data: Buffer; contentType: string } | null> {
    const target = this.filePath(path);
    try {
      const [data, contentType] = await Promise.all([
        readFile(target),
        readFile(`${target}.type`, 'utf8').catch(() => 'application/octet-stream'),
      ]);
      return { data, contentType };
    } catch {
      return null;
    }
  }
}
