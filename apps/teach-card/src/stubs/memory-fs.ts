/**
 * MemoryFs — contracts/types.md §13 LearningFs 的 Wave 0 假實作,吃記憶體裡的 fixture。
 * 整合時(I4)換成 Tauri 的真實作,UI 程式碼不用改(只換這個檔的 import)。
 *
 * §13 是軟約定,packages/contracts 目前是空的(01-data-layer 尚未填),
 * 所以這裡照契約文字自己宣告一份介面,型別一致但不從 packages/contracts import。
 */

export interface LearningFs {
  read(relPath: string): Promise<string>;
  write(relPath: string, content: string): Promise<void>;
  list(relDir: string): Promise<string[]>;
  exists(relPath: string): Promise<boolean>;
  assetUrl(relPath: string): string;
}

function assertSafeRelPath(relPath: string): void {
  if (relPath.startsWith('/') || relPath.split('/').includes('..')) {
    throw new Error(`不合法的路徑(含 .. 或絕對路徑):${relPath}`);
  }
}

export class MemoryFs implements LearningFs {
  private readonly files: Map<string, string>;

  constructor(initial: Record<string, string> = {}) {
    this.files = new Map(Object.entries(initial));
  }

  async read(relPath: string): Promise<string> {
    assertSafeRelPath(relPath);
    const content = this.files.get(relPath);
    if (content === undefined) throw new Error(`找不到檔案:${relPath}`);
    return content;
  }

  async write(relPath: string, content: string): Promise<void> {
    assertSafeRelPath(relPath);
    this.files.set(relPath, content);
  }

  async list(relDir: string): Promise<string[]> {
    assertSafeRelPath(relDir);
    const prefix = relDir === '' ? '' : relDir.endsWith('/') ? relDir : `${relDir}/`;
    return [...this.files.keys()].filter((p) => p.startsWith(prefix));
  }

  async exists(relPath: string): Promise<boolean> {
    assertSafeRelPath(relPath);
    return this.files.has(relPath);
  }

  assetUrl(relPath: string): string {
    assertSafeRelPath(relPath);
    return `/fixtures/${relPath}`;
  }
}
