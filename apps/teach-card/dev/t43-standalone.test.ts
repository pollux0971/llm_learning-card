/**
 * T43(ADR-079)單獨執行:`npm run dev -w apps/teach-card` 的暫存根上按「深入這個」不能打到真的網路。測試 agent 寫;開發 worker 不改。
 *
 * 工單第 6 節:側車環境加 `LC_REVIEW_FAKE_CLOUD=<apps/teach-card/dev/fake-cloud.mjs 的絕對路徑>`;這個檔是新的、由 worker 寫,
 * 照 `apps/test-card/dev/fake-cloud.mjs` 的做法(不 import features/);深入回兩張合格的子卡與考題,延遲約 1.5 秒,看得到生成中。
 * 現在 standalone.ts 只給假金鑰、沒有假網路:按深入會真的連到 provider。
 *
 * 量法:黑箱。起 `startStandaloneBackend()`(真側車、暫存根、fixture 複本),走 teach.open → teach.deepen → teach.poll。
 * 如果環境沒有假網路,deepen 會去連真的 provider——所以先斷言環境變數,斷言沒過就不繼續送 deepen。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// 每條都真的起檔案/行程,負載下會慢:逐檔放寬逾時(不動全域設定)
vi.setConfig({ testTimeout: 30_000 });

const DEV = import.meta.dirname;
const FAKE = join(DEV, 'fake-cloud.mjs');
const STANDALONE = pathToFileURL(join(DEV, 'standalone.ts')).href;

type Obj = Record<string, unknown>;
interface Backend {
  learningDir: string;
  sidecarEnv: Record<string, string | undefined>;
  request(line: string): Promise<string>;
  close(): Promise<void>;
}
interface Mod {
  startStandaloneBackend(opts?: { repoRoot?: string }): Promise<Backend>;
}

describe('單獨執行:假網路', () => {
  it('apps/teach-card/dev/fake-cloud.mjs 存在,而且不 import features/', () => {
    expect(existsSync(FAKE), 'worker 要寫這個檔').toBe(true);
    const text = readFileSync(FAKE, 'utf8');
    expect(text).not.toMatch(/features\//);
    expect(text).toMatch(/globalThis\.fetch\s*=/);
  });

  it('側車環境有 LC_REVIEW_FAKE_CLOUD,指向那個檔的絕對路徑', async () => {
    const mod = (await import(/* @vite-ignore */ STANDALONE)) as Mod;
    const backend = await mod.startStandaloneBackend();
    try {
      const value = backend.sidecarEnv['LC_REVIEW_FAKE_CLOUD'];
      expect(value).toBeDefined();
      expect(isAbsolute(value!)).toBe(true);
      expect(resolve(value!)).toBe(resolve(FAKE));
    } finally {
      await backend.close();
    }
  });

  it('按深入:先回 generating(看得到生成中),輪詢到兩張新卡,各有考題檔;全程不打真網路', async () => {
    expect(existsSync(FAKE), 'fake-cloud.mjs 還沒有,不送 deepen(會連真的 provider)').toBe(true);
    const mod = (await import(/* @vite-ignore */ STANDALONE)) as Mod;
    const backend = await mod.startStandaloneBackend();
    try {
      expect(backend.sidecarEnv['LC_REVIEW_FAKE_CLOUD'], '沒有假網路就不送 deepen').toBeDefined();
      let id = 0;
      const send = async (method: string): Promise<Obj> => {
        id += 1;
        return JSON.parse(await backend.request(JSON.stringify({ v: 1, id, method, params: {} }))) as Obj;
      };
      const opened = await send('teach.open');
      expect(opened['ok'], JSON.stringify(opened)).toBe(true);
      const parentId = ((opened['result'] as Obj)['card'] as Obj)['id'] as string;
      const before = readdirSync(join(backend.learningDir, 'cards/security')).filter((n) => n.endsWith('.md')).sort();

      const started = await send('teach.deepen');
      expect(started['ok'], JSON.stringify(started)).toBe(true);
      expect((started['result'] as Obj)['generating']).toBe(true);

      let sawGenerating = false;
      let done: Obj | undefined;
      const deadline = Date.now() + 25_000;
      while (Date.now() < deadline) {
        const res = await send('teach.poll');
        const generating = res['ok'] === true && (res['result'] as Obj)['generating'] === true;
        if (generating) sawGenerating = true;
        else {
          done = res;
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(sawGenerating, '延遲約 1.5 秒,輪詢要看得到 generating').toBe(true);
      expect(done, '25 秒內要生成完').toBeDefined();
      expect(done!['ok'], JSON.stringify(done)).toBe(true);
      const result = done!['result'] as Obj;
      expect((result['from'] as Obj)['id']).toBe(parentId);
      const after = readdirSync(join(backend.learningDir, 'cards/security')).filter((n) => n.endsWith('.md')).sort();
      const added = after.filter((n) => !before.includes(n));
      expect(added, '兩張合格的子卡').toHaveLength(2);
      for (const name of added) {
        expect(existsSync(join(backend.learningDir, 'questions', name.replace(/\.md$/, '.yaml'))), `${name} 的考題檔`).toBe(true);
      }
    } finally {
      await backend.close();
    }
  }, 60_000);
});
