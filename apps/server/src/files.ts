import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { Artifact } from "../../../packages/domain/src/index.ts";
import { fillPdf, inspectPdf } from "../../../packages/integrations/src/pdf.ts";
import type { Auth } from "./auth.ts";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

const FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * T07.07 (#597): the bounded byte face the enterprise media proxy reads a
 * file through — size first, then offset-addressed pulls with a per-call
 * ceiling, closed by the proxy when the response stream ends.
 */
export interface MediaByteSource {
  readonly sizeBytes: number;
  read(offset: number, maxBytes: number): Promise<Uint8Array>;
  close(): Promise<void>;
}

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).at(-1) ?? "document.pdf";
  // Slice code points, not UTF-16 units, so a surrogate pair is never split in half.
  const cleaned = Array.from(base)
    .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
    .slice(0, 180)
    .join("");
  return cleaned || "document.pdf";
}

function assertFileId(id: string): void {
  if (!FILE_ID.test(id)) throw new AppError("File not found", 404);
}

// Keyed operations need the same ID on every retry, so the ID is derived from the
// owner and operation key instead of random. It is shaped as a version 5 UUID
// (first 128 bits of a SHA-256 hash, version and variant bits set) so it is
// accepted anywhere a random file UUID is.
export function deterministicFileId(owner: string, operationKey: string): string {
  const bytes = createHash("sha256")
    .update(JSON.stringify([owner, operationKey]))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class Files {
  constructor(
    private readonly db: Store,
    private readonly config: Config,
    private readonly auth: Auth,
  ) {}
  async import(
    owner: string,
    name: string,
    bytes: Uint8Array,
    source: string,
    parentId?: string,
    operationKey?: string,
  ): Promise<Artifact> {
    const id = operationKey === undefined ? randomUUID() : deterministicFileId(owner, operationKey);
    if (operationKey !== undefined) {
      const existing = await this.db.get<Artifact>(owner, "files", id);
      if (existing) return this.signed(owner, existing);
    }
    if (bytes.length > 10 * 1024 * 1024) throw new AppError("PDFs must be 10 MB or smaller", 413);
    let metadata = await inspectPdf(bytes);
    if (metadata.pageCount > 500) throw new AppError("PDFs must have 500 pages or fewer", 422);
    const directory = join(this.config.dataDir, "files");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = this.pathFor(id);
    if (operationKey === undefined) {
      await writeFile(path, bytes, { mode: 0o600, flag: "wx" });
    } else {
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
        try {
          await link(temporary, path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          bytes = await readFile(path);
          metadata = await inspectPdf(bytes);
        }
      } finally {
        await rm(temporary, { force: true });
      }
    }
    const safeName = sanitizeFileName(name);
    const artifact: Artifact = {
      id,
      name: safeName,
      mimeType: "application/pdf",
      size: bytes.length,
      pageCount: metadata.pageCount,
      fields: metadata.fields,
      url: "",
      createdAt: new Date().toISOString(),
      source,
      parentId,
    };
    if (operationKey === undefined) {
      await this.db.put(owner, "files", artifact);
      return this.signed(owner, artifact);
    }
    const persisted = await this.db.insertIfAbsent(owner, "files", artifact);
    return this.signed(owner, persisted ?? (await this.get(owner, id)));
  }
  signed(owner: string, file: Artifact): Artifact {
    return { ...file, url: this.auth.sign(owner, `/api/files/${file.id}/content`) };
  }
  async list(owner: string) {
    return (await this.db.list<Artifact>(owner, "files")).map((file) => this.signed(owner, file));
  }
  async get(owner: string, id: string) {
    assertFileId(id);
    const file = await this.db.get<Artifact>(owner, "files", id);
    if (!file) throw new AppError("File not found", 404);
    return file;
  }
  private pathFor(id: string): string {
    assertFileId(id);
    const directory = resolve(this.config.dataDir, "files");
    const resolved = resolve(directory, `${id}.pdf`);
    if (!resolved.startsWith(`${directory}${sep}`)) throw new AppError("File not found", 404);
    return resolved;
  }
  async bytes(owner: string, id: string) {
    await this.get(owner, id);
    return readFile(this.pathFor(id));
  }
  /**
   * T07.07 (#597): the bounded streaming face the enterprise media proxy
   * reads through. Every pull names its own offset and ceiling, so the
   * proxy controls the batch discipline (≤262144 bytes per pull, per the
   * P15 contract the BFF inherits) and never buffers a whole file for an
   * unauthorized reader. The metadata read happens first, as `bytes` does.
   */
  async stream(owner: string, id: string): Promise<MediaByteSource> {
    const _file = await this.get(owner, id);
    const path = this.pathFor(id);
    const { stat, open } = await import("node:fs/promises");
    const info = await stat(path);
    const handle = await open(path, "r");
    return {
      sizeBytes: info.size,
      async read(offset: number, maxBytes: number): Promise<Uint8Array> {
        const want = Math.max(0, Math.min(maxBytes, info.size - offset));
        if (want === 0) return new Uint8Array(0);
        const buffer = Buffer.alloc(want);
        const { bytesRead } = await handle.read(buffer, 0, want, offset);
        return buffer.subarray(0, bytesRead);
      },
      async close(): Promise<void> {
        await handle.close();
      },
    };
  }
  async fill(
    owner: string,
    id: string,
    values: Record<string, string | boolean>,
    operationKey?: string,
  ) {
    const file = await this.get(owner, id);
    const bytes = await this.bytes(owner, id);
    const output = await fillPdf(bytes, values);
    return this.import(
      owner,
      `${file.name.replace(/\.pdf$/i, "")} — filled.pdf`,
      output,
      `Filled from ${file.name}`,
      id,
      operationKey === undefined
        ? undefined
        : JSON.stringify([
            "fill",
            operationKey,
            id,
            Object.keys(values)
              .sort()
              .map((name) => [name, values[name]]),
          ]),
    );
  }
}
