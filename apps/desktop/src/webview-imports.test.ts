/**
 * T2c-1 驗收 A4:webview 端的 LearningFs 與它 import 的每一個檔,都沒有 node: 模組、沒有 @core/schema/log。
 * 測試 agent 寫的;實作者不要改。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isNodeModule, isSchemaLog, REPO_ROOT, scanImportGraph } from './test-support/import-scan.js';
import { WEBVIEW_LEARNING_FS } from './test-support/webview-learning-fs.js';

describe('the web view LearningFs imports nothing from node', () => {
  it('no file in its import graph imports a node: module or the schema log module', () => {
    const graph = scanImportGraph(WEBVIEW_LEARNING_FS);
    expect(graph.files[0]).toBe('apps/desktop/src/webview/learning-fs.ts');
    const unresolved = graph.imports.filter((i) => i.spec.startsWith('UNRESOLVED:'));
    expect(unresolved, 'every relative import must resolve to a file').toEqual([]);
    expect(graph.imports.filter((i) => isNodeModule(i.spec))).toEqual([]);
    expect(graph.imports.filter((i) => isSchemaLog(i.spec, i.file))).toEqual([]);
  });

  it('it uses the Tauri invoke', () => {
    const graph = scanImportGraph(WEBVIEW_LEARNING_FS);
    expect(graph.imports.map((i) => i.spec)).toContain('@tauri-apps/api/core');
  });
});

describe('the import scanner itself', () => {
  it('follows relative imports and aliases and finds node and schema-log imports two levels down', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lc-scan-'));
    try {
      mkdirSync(join(dir, 'sub'));
      writeFileSync(join(dir, 'entry.ts'), "import { b } from './sub/b.js';\nexport const a = b;\n");
      writeFileSync(
        join(dir, 'sub', 'b.ts'),
        "// import { nope } from 'node:comment';\nimport { readFileSync } from 'fs';\nexport { recordEvent } from " + JSON.stringify('@core/schema/log.js') + ";\nexport const b = readFileSync;\n",
      );
      const graph = scanImportGraph(join(dir, 'entry.ts'), REPO_ROOT);
      const fromB = graph.imports.filter((i) => i.file.endsWith('sub/b.ts'));
      expect(fromB.filter((i) => isNodeModule(i.spec)).map((i) => i.spec)).toEqual(['fs']);
      expect(fromB.some((i) => isSchemaLog(i.spec, i.file))).toBe(true);
      expect(graph.imports.some((i) => i.spec === 'node:comment')).toBe(false);
      // 別名有跟進去:log.ts 自己拉的 node:fs(經 atomic-write.ts)也被看到了。
      expect(graph.files).toContain('packages/core/src/schema/log.ts');
      expect(graph.imports.some((i) => i.spec === 'node:fs')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('flags node: with a prefix and builtin subpaths', () => {
    expect(isNodeModule('node:fs')).toBe(true);
    expect(isNodeModule('fs/promises')).toBe(true);
    expect(isNodeModule('child_process')).toBe(true);
    expect(isNodeModule('@tauri-apps/api/core')).toBe(false);
    expect(isNodeModule('svelte')).toBe(false);
  });
});
