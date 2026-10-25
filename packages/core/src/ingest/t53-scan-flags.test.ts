/**
 * T53 單元測試 D:來源改了標 stale、來源刪了標 source_missing(02 phase-3 場景 5、6),和「怎麼標」的位元組規則。測試 agent 寫;開發 worker 不改。
 * 工單:docs/tickets/T53-ingest-phase3-incremental-stale.md「D」與顧問加 1(2026-10-25)。
 *
 *   - 標記 = 文字處理:frontmatter 結尾那一行 `---` 前面插一行 `stale: true`(或 `source_missing: true`),用檔案原本的換行;整個檔除了那一行位元組完全相同。
 *     測試用的卡帶會被「解析再序列化」弄壞的寫法:帶引號的日期與標題、YAML 註解、不是預設順序的鍵、一張 CRLF。
 *   - 頂層已經有 `stale: false`(`source_missing: false`)那一行:只換那一行,不插第二行(YAML 重複的鍵會讓卡讀不了)。
 *   - 已經標過(`stale: true`):不再寫檔——位元組與 mtime 都不變,只算進報出來的張數。
 *   - 別的寫法(`stale: yes`、`stale: "false"`):不動那張卡,報在 unreadableFlags。
 *   - ingested.json 的 sha 不更新(之後每次跑都報同一批);不重新生成、不叫 LLM;卡、考題都留著;卡檔本身被刪的不重建。
 *   - 寫入走 01 的 writeFileAtomic / appendLineAtomic(spy 看得到)。
 */
import { existsSync, readFileSync, rmSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  cardPath, countingRouter, expectedMarked, ingestOne, ingestedJson, loadScan, makeLearning, mtimeOf, overwriteCards, rawText, readCard, trickyCards, writeRaw,
} from './t53-test-support.js';

vi.mock('@core/schema/atomic-write.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('@core/schema/atomic-write.js')>();
  return { ...real, writeFileAtomic: vi.fn(real.writeFileAtomic), appendLineAtomic: vi.fn(real.appendLineAtomic) };
});
const atomic = await import('@core/schema/atomic-write.js');

const TODAY = '2026-09-10';
const RAW = 't53-src.md';
const REL = `raw/security/${RAW}`;

/** 處理 RAW 產生三張卡,然後把三張卡換成會被正規化弄壞的寫法;回傳 id 與換掉之後的原文 */
async function seed(): Promise<{ dir: string; ids: string[]; originals: string[]; sha: string }> {
  const dir = makeLearning();
  writeRaw(dir, 'security', RAW, rawText('v1'));
  const ids = await ingestOne(dir, 'security', RAW, ['卡一', '卡二', '卡三']);
  expect(ids.length).toBe(3);
  const originals = trickyCards('security', ids, REL);
  overwriteCards(dir, 'security', ids, originals);
  mkdirSync(join(dir, 'questions'), { recursive: true });
  for (const id of ids) writeFileSync(join(dir, 'questions', `${id}.yaml`), `card: ${id}\nfill: []\napply: []\n`, 'utf8');
  return { dir, ids, originals, sha: ingestedJson(dir)[REL]!.sha256 };
}

const quiet = () => countingRouter({}); // 沒錄任何回應:叫了就丟錯

describe('T53 D. raw 改了 → 那個檔的卡標 stale(場景 5)', () => {
  it('每張卡除了插(或換)的那一行,位元組完全相同;沒叫 LLM;報出三張', async () => {
    const scan = await loadScan();
    const { dir, ids, originals } = await seed();
    writeFileSync(join(dir, REL), rawText('v2-edited'), 'utf8');
    const { router, calls } = quiet();
    const result = await scan({ outDir: dir, router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(result.refused).toBeUndefined();
    expect([...result.staleCards].sort()).toEqual([...ids].sort());
    expect(result.missingSourceCards).toEqual([]);
    expect(result.processed, '不重新生成').toEqual([]);
    expect(calls, '標 stale 不叫 LLM').toHaveLength(0);
    ids.forEach((id, i) => {
      expect(readCard(dir, 'security', id), `卡 ${id}(${['LF 帶引號與註解', 'CRLF', '已有 stale: false'][i]})`).toBe(expectedMarked(originals[i]!, 'stale'));
    });
    expect(readCard(dir, 'security', ids[2]!).match(/^stale:/gm)?.length, '已經有 stale: false 的卡只換那一行,不能出現第二個 stale 鍵').toBe(1);
    expect(readCard(dir, 'security', ids[2]!)).toContain('source_missing: false');
  });

  it('ingested.json 的 sha 不更新、不重新生成;再掃一次報同一批,卡不再被寫(位元組與 mtime 不變)', async () => {
    const scan = await loadScan();
    const { dir, ids, sha } = await seed();
    writeFileSync(join(dir, REL), rawText('v2-edited'), 'utf8');
    const first = await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect([...first.staleCards].sort()).toEqual([...ids].sort());
    expect(ingestedJson(dir)[REL]!.sha256, 'sha 代表卡是從哪一版生的:不更新').toBe(sha);
    expect(ingestedJson(dir)[REL]!.cardIds).toEqual(ids);
    const bytes = ids.map((id) => readCard(dir, 'security', id));
    const old = new Date('2026-01-01T00:00:00Z');
    ids.forEach((id) => utimesSync(cardPath(dir, 'security', id), old, old));
    const mtimes = ids.map((id) => mtimeOf(cardPath(dir, 'security', id)));
    const second = await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect([...second.staleCards].sort(), '之後每次跑都報同一批(含已經標過的)').toEqual([...ids].sort());
    ids.forEach((id, i) => {
      expect(readCard(dir, 'security', id), `卡 ${id} 位元組不變`).toBe(bytes[i]);
      expect(mtimeOf(cardPath(dir, 'security', id)), `卡 ${id} 沒有被重寫(mtime 不變)`).toBe(mtimes[i]);
    });
    expect(ingestedJson(dir)[REL]!.sha256).toBe(sha);
  });

  it('已經標過 stale: true 的卡:位元組與 mtime 都不變,但算進報出來的張數', async () => {
    const scan = await loadScan();
    const { dir, ids, originals } = await seed();
    const already = originals[0]!.replace('\n---\n\n', '\nstale: true\n---\n\n');
    expect(already).not.toBe(originals[0]);
    writeFileSync(cardPath(dir, 'security', ids[0]!), already, 'utf8');
    const old = new Date('2026-01-01T00:00:00Z');
    utimesSync(cardPath(dir, 'security', ids[0]!), old, old);
    const m = mtimeOf(cardPath(dir, 'security', ids[0]!));
    writeFileSync(join(dir, REL), rawText('v2-edited'), 'utf8');
    const result = await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(result.staleCards).toContain(ids[0]);
    expect(readCard(dir, 'security', ids[0]!), '已標過的位元組不變').toBe(already);
    expect(mtimeOf(cardPath(dir, 'security', ids[0]!)), '已標過的沒有被重寫').toBe(m);
    expect(readCard(dir, 'security', ids[1]!)).toBe(expectedMarked(originals[1]!, 'stale'));
  });

  it('旗標寫成別的樣子(stale: yes、stale: "false"):不動那張卡、報在 unreadableFlags,其他卡照標', async () => {
    const scan = await loadScan();
    const { dir, ids, originals } = await seed();
    const yes = originals[0]!.replace('\n---\n\n', '\nstale: yes\n---\n\n');
    const quoted = originals[2]!.replace('stale: false', 'stale: "false"');
    writeFileSync(cardPath(dir, 'security', ids[0]!), yes, 'utf8');
    writeFileSync(cardPath(dir, 'security', ids[2]!), quoted, 'utf8');
    writeFileSync(join(dir, REL), rawText('v2-edited'), 'utf8');
    const result = await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(readCard(dir, 'security', ids[0]!), '看不懂的不動').toBe(yes);
    expect(readCard(dir, 'security', ids[2]!), '看不懂的不動').toBe(quoted);
    expect([...result.unreadableFlags].sort()).toEqual([ids[0]!, ids[2]!].sort());
    expect(readCard(dir, 'security', ids[1]!), '看得懂的照標').toBe(expectedMarked(originals[1]!, 'stale'));
  });

  it('卡檔本身被刪的:略過那一張,不重建,其他照標', async () => {
    const scan = await loadScan();
    const { dir, ids, originals } = await seed();
    rmSync(cardPath(dir, 'security', ids[1]!));
    writeFileSync(join(dir, REL), rawText('v2-edited'), 'utf8');
    await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(existsSync(cardPath(dir, 'security', ids[1]!)), '不重建').toBe(false);
    expect(readCard(dir, 'security', ids[0]!)).toBe(expectedMarked(originals[0]!, 'stale'));
    expect(readCard(dir, 'security', ids[2]!)).toBe(expectedMarked(originals[2]!, 'stale'));
  });

  it('寫入走 01 的原子寫入:卡檔經過 writeFileAtomic、事件經過 appendLineAtomic', async () => {
    const scan = await loadScan();
    const { dir, ids } = await seed();
    writeFileSync(join(dir, REL), rawText('v2-edited'), 'utf8');
    vi.mocked(atomic.writeFileAtomic).mockClear();
    vi.mocked(atomic.appendLineAtomic).mockClear();
    await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    const written = vi.mocked(atomic.writeFileAtomic).mock.calls.map((c) => String(c[0]));
    for (const id of ids) expect(written, `卡 ${id} 要經過 writeFileAtomic`).toContain(cardPath(dir, 'security', id));
    expect(vi.mocked(atomic.appendLineAtomic).mock.calls.length, '掃描要記事件,經過 appendLineAtomic').toBeGreaterThan(0);
  });
});

describe('T53 D. raw 刪了 → 卡留著、標 source_missing(場景 6)', () => {
  it('卡與考題都在,每張除了那一行位元組相同;沒叫 LLM;報出三張;sha 不動', async () => {
    const scan = await loadScan();
    const { dir, ids, originals, sha } = await seed();
    rmSync(join(dir, REL));
    const questionBytes = ids.map((id) => readFileSync(join(dir, 'questions', `${id}.yaml`), 'utf8'));
    const { router, calls } = quiet();
    const result = await scan({ outDir: dir, router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(result.refused).toBeUndefined();
    expect([...result.missingSourceCards].sort()).toEqual([...ids].sort());
    expect(result.staleCards).toEqual([]);
    expect(calls).toHaveLength(0);
    ids.forEach((id, i) => {
      expect(existsSync(cardPath(dir, 'security', id)), `卡 ${id} 還在`).toBe(true);
      expect(readCard(dir, 'security', id), `卡 ${id}`).toBe(expectedMarked(originals[i]!, 'source_missing'));
      expect(readFileSync(join(dir, 'questions', `${id}.yaml`), 'utf8'), `考題 ${id} 不動`).toBe(questionBytes[i]);
    });
    expect(readCard(dir, 'security', ids[2]!).match(/^source_missing:/gm)?.length, '已有 source_missing: false 的只換那一行').toBe(1);
    expect(ingestedJson(dir)[REL]!.sha256).toBe(sha);
    expect(ingestedJson(dir)[REL]!.cardIds).toEqual(ids);
  });

  it('再掃一次:報同一批,卡不再被寫(位元組與 mtime 不變)', async () => {
    const scan = await loadScan();
    const { dir, ids } = await seed();
    rmSync(join(dir, REL));
    await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    const bytes = ids.map((id) => readCard(dir, 'security', id));
    const old = new Date('2026-01-01T00:00:00Z');
    ids.forEach((id) => utimesSync(cardPath(dir, 'security', id), old, old));
    const mtimes = ids.map((id) => mtimeOf(cardPath(dir, 'security', id)));
    const second = await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect([...second.missingSourceCards].sort()).toEqual([...ids].sort());
    ids.forEach((id, i) => {
      expect(readCard(dir, 'security', id)).toBe(bytes[i]);
      expect(mtimeOf(cardPath(dir, 'security', id)), `卡 ${id} 沒被重寫`).toBe(mtimes[i]);
    });
  });

  it('標 source_missing 的卡,先前 raw 被改過又被刪:兩個旗標可以並存,各只加自己的那一行', async () => {
    const scan = await loadScan();
    const { dir, ids, originals } = await seed();
    writeFileSync(join(dir, REL), rawText('v2-edited'), 'utf8');
    await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    rmSync(join(dir, REL));
    await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    ids.forEach((id, i) => {
      expect(readCard(dir, 'security', id), `卡 ${id}`).toBe(expectedMarked(expectedMarked(originals[i]!, 'stale'), 'source_missing'));
    });
  });
});

describe('T53 D. 沒改的 raw 不標任何旗標', () => {
  it('sha 一樣 → 卡位元組不變、staleCards 與 missingSourceCards 都是空的', async () => {
    const scan = await loadScan();
    const { dir, ids, originals } = await seed();
    const result = await scan({ outDir: dir, router: quiet().router, category: 'security', today: TODAY, levelZeroOnly: true });
    expect(result.staleCards).toEqual([]);
    expect(result.missingSourceCards).toEqual([]);
    ids.forEach((id, i) => expect(readCard(dir, 'security', id)).toBe(originals[i]));
  });
});
