/**
 * Wave 0 的 LearningFs 實作(契約 §13)。整合時(I3)換成 Tauri 的真實檔案系統版本。
 * 這個版本純粹在記憶體裡存字串,重整頁面就消失——符合 FEATURE.md「答案不落地」的要求。
 */
import type { LearningFs } from '../types.js';

function guard(relPath: string): string {
  if (relPath.startsWith('/') || relPath.split('/').includes('..')) {
    throw new Error(`不合法的路徑(禁止絕對路徑與 ..):${relPath}`);
  }
  return relPath.replace(/\\/g, '/');
}

export class MemoryFs implements LearningFs {
  private files = new Map<string, string>();

  constructor(seed: Record<string, string> = {}) {
    for (const [relPath, content] of Object.entries(seed)) {
      this.files.set(guard(relPath), content);
    }
  }

  async read(relPath: string): Promise<string> {
    const p = guard(relPath);
    const content = this.files.get(p);
    if (content === undefined) throw new Error(`找不到檔案:${p}`);
    return content;
  }

  async write(relPath: string, content: string): Promise<void> {
    this.files.set(guard(relPath), content);
  }

  async list(relDir: string): Promise<string[]> {
    const dir = guard(relDir).replace(/\/$/, '');
    const prefix = dir ? `${dir}/` : '';
    const names = new Set<string>();
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      names.add(key.slice(prefix.length).split('/')[0]!);
    }
    return [...names].sort();
  }

  async exists(relPath: string): Promise<boolean> {
    return this.files.has(guard(relPath));
  }

  assetUrl(relPath: string): string {
    return `memory://${guard(relPath)}`;
  }
}
