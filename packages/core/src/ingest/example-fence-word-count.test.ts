/**
 * T20 → T57:舊 `word-count-min.test.ts` 的邊界案例原本搬到這裡;T57 起它們全部是 `contracts/fixtures/word-count-vectors.json` 的列
 * (對照:`docs/reviews/T57-old-vectors-map.md`),由 `features/support/word-count-vectors.test.ts` 讓 ingest 的路與其他實作一起跑。
 * 留下來的是「不是向量」的差分:同一段 body,ingest 的 `enforceWordLimit` 第一次字數 = `validateCard` 的 `bodyWordCount`,
 * 對向量檔的每一列都比(向量檔增加的列自動納入)。測試 agent 寫;開發 worker 不改。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateCard } from '@core/schema/index.js';
import { describe, expect, it } from 'vitest';
import { enforceWordLimit } from './generate-cards.js';

const ROOT = join(import.meta.dirname, '../../../..');
interface Row {
  name: string;
  body?: string;
  fixture?: string;
}
const rows = (JSON.parse(readFileSync(join(ROOT, 'contracts/fixtures/word-count-vectors.json'), 'utf8')) as { rows: Row[] }).rows;
const FM_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
const bodyOf = (r: Row): string => r.body ?? readFileSync(join(ROOT, 'contracts/fixtures', r.fixture!), 'utf8').replace(FM_RE, '');

/** ingest 對這段 body 算出的字數。字數超過上限時 LLM 回一筆短卡,只為了讓它收尾;看的是第一次嘗試。 */
async function ingestCount(body: string): Promise<number> {
  const r = await enforceWordLimit(
    async () => ({ text: JSON.stringify([{ body: 'ok' }]) }),
    'ingest.cards',
    'security',
    'test',
    { title: 't', body, examples: [] },
  );
  return r.attempts[0]!.wordCount;
}

describe('T20 差分:同一段 body,ingest 算出的字數 = validateCard 的 bodyWordCount(向量檔每一列)', () => {
  const FM = '---\nid: sec-0001\ncategory: security\ntitle: t\nlevel: 0\nsource: llm\ncreated: 2026-09-01\n---\n';
  it('向量檔有列可比', () => {
    expect(rows.length).toBeGreaterThan(100);
  });
  it('每一列都一樣', async () => {
    const wrong: string[] = [];
    for (const row of rows) {
      const body = bodyOf(row);
      const viaValidate = validateCard(FM + body + '\n').bodyWordCount;
      const viaIngest = await ingestCount(body);
      if (viaIngest !== viaValidate) wrong.push(`「${row.name}」ingest ${viaIngest}、validateCard ${viaValidate}`);
    }
    expect(wrong, wrong.join('\n')).toEqual([]);
  });
});
