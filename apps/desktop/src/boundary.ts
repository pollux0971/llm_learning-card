/**
 * 10-desktop-shell phase-2 的 LearningFs 邊界。
 *
 * 測試走無頭 probe(`lc-fs`),跟 Tauri command 呼叫同一份 Rust library。
 * assetUrl 是同步提示:自己丟錯,不呼叫 recordEvent。權威是 requestAsset。
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { recordEvent } from '@core/schema/log.js';

export interface FsCall {
  op: string;
  path: string;
}

export interface BoundaryResult {
  ok: boolean;
  value?: string | boolean | string[];
  refused?: boolean;
  fsCalls: FsCall[];
  rustLog: string[];
  checked?: string;
  url?: string;
}

export interface Boundary {
  root: string;
  logPath: string;
  read(relPath: string): Promise<string>;
  write(relPath: string, content: string): Promise<void>;
  list(relDir: string): Promise<string[]>;
  exists(relPath: string): Promise<boolean>;
  assetUrl(relPath: string): string;
  requestAsset(urlPath: string): Promise<BoundaryResult>;
  last(): BoundaryResult;
}

const BIN = join(import.meta.dirname, '../src-tauri/target/debug/lc-fs');

interface ProbeResp {
  ok: boolean;
  refused: boolean;
  value: string | boolean | string[] | null;
  fsCalls: FsCall[];
  rustLog: string[];
  checked?: string | null;
}

function probe(body: Record<string, unknown>): ProbeResp {
  const r = spawnSync(BIN, { input: JSON.stringify(body), encoding: 'utf8' });
  if (r.error) throw r.error;
  if (r.status !== 0 && !r.stdout) {
    throw new Error(`lc-fs 失敗 status=${r.status} ${r.stderr}`);
  }
  return JSON.parse(r.stdout) as ProbeResp;
}

function toResult(resp: ProbeResp): BoundaryResult {
  const out: BoundaryResult = {
    ok: resp.ok,
    refused: resp.refused,
    fsCalls: resp.fsCalls ?? [],
    rustLog: resp.rustLog ?? [],
  };
  if (resp.value !== null && resp.value !== undefined) out.value = resp.value;
  if (resp.checked !== null && resp.checked !== undefined) out.checked = resp.checked;
  return out;
}

function refusedError(path: string): Error & { refused: true } {
  const err = new Error(`refused: ${path}`) as Error & { refused: true };
  err.refused = true;
  return err;
}

/** 提示用的謄本。Rust 才是權威。非 ASCII 只做 NFC 與保留名上標,類別以 Rust 為準。 */
export function hintRelPath(rel: string): void {
  if (rel.length === 0 || rel.startsWith('/') || rel.endsWith('/') || rel.includes('//')) {
    throw refusedError(rel);
  }
  if (Buffer.byteLength(rel, 'utf8') > 240) throw refusedError(rel);
  if (rel.normalize('NFC') !== rel) throw refusedError(rel);
  const reserved = new Set([
    'con', 'prn', 'aux', 'nul',
    ...'123456789'.split('').flatMap((n) => [`com${n}`, `lpt${n}`]),
  ]);
  const sup = ['\u00B9', '\u00B2', '\u00B3'];
  for (const s of sup) {
    reserved.add(`com${s}`);
    reserved.add(`lpt${s}`);
  }
  const first = rel.split('/')[0] ?? '';
  if (asciiFold(first) === 'raw') throw refusedError(rel);
  for (const seg of rel.split('/')) {
    if (seg.length === 0 || seg.startsWith('.') || seg.endsWith('.')) throw refusedError(rel);
    const stem = asciiFold(seg.split('.')[0] ?? seg);
    if (reserved.has(stem)) throw refusedError(rel);
    for (const ch of seg) {
      if (/^[A-Za-z0-9_.-]$/.test(ch)) continue;
      if (ch.codePointAt(0)! < 128) throw refusedError(rel);
    }
  }
}

function asciiFold(s: string): string {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

export function assetUrlFor(rel: string): string {
  const encoded = rel.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  return `lc://localhost/${encoded}`;
}

class ProbeBoundary implements Boundary {
  root: string;
  logPath: string;
  private current: BoundaryResult = { ok: false, fsCalls: [], rustLog: [] };

  constructor(root: string) {
    this.root = root;
    this.logPath = join(root, 'state', 'log.jsonl');
  }

  last(): BoundaryResult {
    return this.current;
  }

  private noteRefusal(rel: string, resp: ProbeResp): never {
    this.current = toResult(resp);
    recordEvent(this.logPath, {
      ts: new Date().toISOString(),
      type: 'warning',
      path: rel,
      reason: 'path-refused',
    });
    throw refusedError(rel);
  }

  async read(relPath: string): Promise<string> {
    const resp = probe({ op: 'read', root: this.root, path: relPath });
    if (!resp.ok) this.noteRefusal(relPath, resp);
    this.current = toResult(resp);
    return String(resp.value ?? '');
  }

  async write(relPath: string, content: string): Promise<void> {
    const resp = probe({ op: 'write', root: this.root, path: relPath, content });
    if (!resp.ok) this.noteRefusal(relPath, resp);
    this.current = toResult(resp);
  }

  async list(relDir: string): Promise<string[]> {
    const resp = probe({ op: 'list', root: this.root, path: relDir });
    if (!resp.ok) this.noteRefusal(relDir, resp);
    this.current = toResult(resp);
    return (resp.value as string[]) ?? [];
  }

  async exists(relPath: string): Promise<boolean> {
    const resp = probe({ op: 'exists', root: this.root, path: relPath });
    if (!resp.ok) this.noteRefusal(relPath, resp);
    this.current = toResult(resp);
    return resp.value === true;
  }

  assetUrl(relPath: string): string {
    try {
      hintRelPath(relPath);
    } catch (err) {
      this.current = { ok: false, refused: true, fsCalls: [], rustLog: [] };
      throw err;
    }
    const url = assetUrlFor(relPath);
    this.current = { ok: true, fsCalls: [], rustLog: [], url };
    return url;
  }

  async requestAsset(urlPath: string): Promise<BoundaryResult> {
    const resp = probe({ op: 'asset', root: this.root, path: urlPath });
    this.current = toResult(resp);
    return this.current;
  }
}

export function openBoundary(root: string): Boundary {
  return new ProbeBoundary(root);
}
