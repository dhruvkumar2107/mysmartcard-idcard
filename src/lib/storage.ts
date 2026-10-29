import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { badRequest } from "./errors";

/**
 * Private object storage. Files are written outside `public/` and are only
 * served through /api/files/[id], which performs per-file authorization.
 * Swap `LocalDiskStorage` for an S3 / R2 / Vercel Blob (private) adapter in
 * production — see DEPLOYMENT.md.
 */
export interface StorageAdapter {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

class LocalDiskStorage implements StorageAdapter {
  constructor(private root: string) {}
  private resolve(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw badRequest("Invalid storage key");
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.resolve(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data);
  }
  async get(key: string) {
    return readFile(this.resolve(key));
  }
  async remove(key: string) {
    await unlink(this.resolve(key)).catch(() => undefined);
  }
}

/**
 * Neon Object Storage (S3-compatible). Credentials, endpoint and region come from the
 * AWS-standard env vars Neon injects (`neon env pull` / `neon deploy`). The bucket is private;
 * objects are only ever streamed back through the authorizing /api/files route.
 */
class S3Storage implements StorageAdapter {
  private client: import("@aws-sdk/client-s3").S3Client | null = null;
  constructor(private bucket: string) {}
  private async s3() {
    const sdk = await import("@aws-sdk/client-s3");
    const c = storageEnv()!;
    this.client ??= new sdk.S3Client({
      forcePathStyle: true, // required by Neon Object Storage
      endpoint: c.endpoint,
      region: c.region,
      credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
    });
    return { sdk, client: this.client };
  }
  async put(key: string, data: Buffer) {
    const { sdk, client } = await this.s3();
    await client.send(new sdk.PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data }));
  }
  async get(key: string) {
    const { sdk, client } = await this.s3();
    const res = await client.send(new sdk.GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
  async remove(key: string) {
    const { sdk, client } = await this.s3();
    await client.send(new sdk.DeleteObjectCommand({ Bucket: this.bucket, Key: key })).catch(() => undefined);
  }
}

/**
 * Object-storage credentials. `STORAGE_*` names are used on hosts that reserve `AWS_*`
 * variables (Vercel); locally the AWS-standard names written by `neon env pull` work too.
 */
function storageEnv() {
  const e = process.env;
  const endpoint = e.STORAGE_ENDPOINT_URL ?? e.AWS_ENDPOINT_URL_S3;
  const accessKeyId = e.STORAGE_ACCESS_KEY_ID ?? e.AWS_ACCESS_KEY_ID;
  const secretAccessKey = e.STORAGE_SECRET_ACCESS_KEY ?? e.AWS_SECRET_ACCESS_KEY;
  const region = e.STORAGE_REGION ?? e.AWS_REGION ?? "us-east-1";
  return endpoint && accessKeyId && secretAccessKey ? { endpoint, accessKeyId, secretAccessKey, region } : null;
}

export function storageBackend() {
  return storageEnv() ? "Neon Object Storage" : "Local disk";
}

let adapter: StorageAdapter | null = null;
export function storage(): StorageAdapter {
  adapter ??= storageEnv()
    ? new S3Storage(process.env.STORAGE_BUCKET || "uploads")
    : new LocalDiskStorage(process.env.STORAGE_DIR ?? path.join(process.cwd(), ".data", "uploads"));
  return adapter;
}

export const UPLOAD_RULES = {
  image: { maxBytes: 2 * 1024 * 1024, types: { "image/jpeg": [0xff, 0xd8, 0xff], "image/png": [0x89, 0x50, 0x4e, 0x47], "image/webp": [0x52, 0x49, 0x46, 0x46] } },
  document: {
    maxBytes: 4 * 1024 * 1024, // stays under the 4.5 MB serverless request-body limit
    types: {
      "application/pdf": [0x25, 0x50, 0x44, 0x46],
      "image/jpeg": [0xff, 0xd8, 0xff],
      "image/png": [0x89, 0x50, 0x4e, 0x47],
      // DOCX / PPTX / XLSX are zip containers
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [0x50, 0x4b, 0x03, 0x04],
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": [0x50, 0x4b, 0x03, 0x04],
    },
  },
} as const;

export type UploadKind = keyof typeof UPLOAD_RULES;

/** Validate size, declared type AND magic bytes; returns a buffer safe to store. */
export async function validateUpload(file: File, kind: UploadKind): Promise<{ buffer: Buffer; mimeType: string; name: string }> {
  const rules = UPLOAD_RULES[kind];
  if (!file || file.size === 0) throw badRequest("Please choose a file.");
  if (file.size > rules.maxBytes) throw badRequest(`File is too large (max ${Math.round(rules.maxBytes / 1024 / 1024)} MB).`);
  const signatures = rules.types as Record<string, readonly number[]>;
  const sig = signatures[file.type];
  if (!sig) throw badRequest(`File type not allowed. Allowed: ${Object.keys(signatures).map((t) => t.split("/")[1].split(".").pop()).join(", ")}`);
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!sig.every((b, i) => buffer[i] === b)) throw badRequest("File contents do not match its type.");
  const name = path.basename(file.name).replace(/[^\w.\- ()]/g, "_").slice(0, 120) || "file";
  return { buffer, mimeType: file.type, name };
}

export function newStorageKey(institutionId: string, ownerType: string) {
  return `${institutionId}/${ownerType}/${randomUUID()}`;
}
