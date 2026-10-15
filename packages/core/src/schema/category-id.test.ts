/**
 * T6:`CategoryId` 的共用驗證函式(契約 1.4.0 §1、ADR-067)。
 *
 * 這份測試的作者是測試 agent,開發 worker 不改它。
 * 驗證函式的約定(測試釘住的介面):
 *   模組  packages/core/src/schema/category-id.ts
 *   匯出  validateCategoryId(value: string): { ok: true } | { ok: false; rule: string }
 *   rule  是 contracts/fixtures/path-segment-vectors.json 的 rule 欄用的名字:
 *         charset nfc leading-dot trailing-dot reserved empty separator length
 *
 * 模組用動態 import 載入:實作還不存在時 tsc 仍然 0 錯,vitest 以「找不到模組」變紅。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface VectorRow {
  segment: string;
  expect: 'accept' | 'refuse';
  applies_to: string[];
  rule: string;
  why: string;
}
type Verdict = { ok: true } | { ok: false; rule: string };
type Validate = (value: string) => Verdict;

const VALIDATOR_MODULE: string = './category-id.js';
const VECTORS_URL = new URL('../../../../contracts/fixtures/path-segment-vectors.json', import.meta.url);

async function loadValidator(): Promise<Validate> {
  const mod = (await import(/* @vite-ignore */ VALIDATOR_MODULE)) as { validateCategoryId: Validate };
  return mod.validateCategoryId;
}

function loadVectors(): VectorRow[] {
  // 每次執行時讀檔本身;不把向量複製成測試裡的常數(T6 must_catch 最後一條)。
  const file = JSON.parse(readFileSync(fileURLToPath(VECTORS_URL), 'utf8')) as { vectors: VectorRow[] };
  return file.vectors;
}

/** 用 applies_to 選列,不用 rule 欄分(向量檔語意)。 */
function categoryRows(): VectorRow[] {
  return loadVectors().filter((r) => r.applies_to.includes('category'));
}

describe('path-segment-vectors.json 是真的被載入', () => {
  it('檔案在、列數對得上(防止測試對著空陣列綠)', () => {
    const rows = loadVectors();
    expect(rows.length).toBe(51);
    expect(categoryRows().length).toBe(51);
    expect(rows.filter((r) => r.applies_to.includes('segment')).length).toBe(47);
    // 只適用 category 的四列是長度列(64 ok / 65 refuse,各有 ASCII 與 21 個 U+AC00 兩種)
    const onlyCategory = rows.filter((r) => !r.applies_to.includes('segment'));
    expect(onlyCategory.map((r) => r.rule)).toEqual(['length', 'length', 'length', 'length']);
    expect(createHash('sha256').update(readFileSync(fileURLToPath(VECTORS_URL))).digest('hex')).toBe(
      '71dded0ecbe5376fdb9adbe417f82e0d27d756d7256d359c6516e75e8ac7a1c6',
    );
  });
});

describe('validateCategoryId 對每一列向量', () => {
  it('applies_to 含 category 的每一列,結果等於 expect;拒絕時 rule 等於該列的 rule', async () => {
    const validate = await loadValidator();
    const failures: string[] = [];
    let ran = 0;
    for (const row of categoryRows()) {
      const verdict = validate(row.segment);
      ran += 1;
      const want = row.expect === 'accept';
      if (verdict.ok !== want) {
        failures.push(`${JSON.stringify(row.segment)} expect=${row.expect} got ok=${verdict.ok} (${row.why})`);
      } else if (!verdict.ok && verdict.rule !== row.rule) {
        failures.push(`${JSON.stringify(row.segment)} rule 應為 ${row.rule},得到 ${verdict.rule}`);
      }
    }
    expect(ran).toBe(51);
    expect(failures).toEqual([]);
  });

  it('檔案裡出現過的每一個 rule 值,都至少有一列被跑到(某類向量被刪光會紅)', async () => {
    const validate = await loadValidator();
    const seen = new Set<string>();
    for (const row of categoryRows()) {
      validate(row.segment);
      seen.add(row.rule);
    }
    const inFile = new Set(loadVectors().map((r) => r.rule));
    expect([...seen].sort()).toEqual([...inFile].sort());
    for (const rule of ['charset', 'nfc', 'leading-dot', 'trailing-dot', 'reserved', 'empty', 'separator', 'length']) {
      expect(seen.has(rule)).toBe(true);
    }
  });

  it('各 rule 的列數被釘住(向量檔一改,這條紅,改的人要同時更新數字)', () => {
    const counts: Record<string, number> = {};
    for (const row of loadVectors()) counts[row.rule] = (counts[row.rule] ?? 0) + 1;
    expect(counts).toEqual({
      charset: 21,
      reserved: 15,
      nfc: 5,
      length: 4,
      'leading-dot': 3,
      empty: 1,
      separator: 1,
      'trailing-dot': 1,
    });
  });

  it('length 那四列只適用 category:同樣的字串當成 §13 的段(沒有 64 上限),實作的驗證函式仍依 §1 拒絕 65 位元組', async () => {
    const validate = await loadValidator();
    const longRows = categoryRows().filter((r) => !r.applies_to.includes('segment'));
    expect(longRows.length).toBe(4);
    const refused = longRows.filter((r) => r.expect === 'refuse');
    expect(refused.length).toBe(2);
    for (const r of refused) {
      expect(new TextEncoder().encode(r.segment).length).toBe(65);
      expect(validate(r.segment)).toEqual({ ok: false, rule: 'length' });
    }
    for (const r of longRows.filter((x) => x.expect === 'accept')) {
      expect(new TextEncoder().encode(r.segment).length).toBe(64);
      expect(validate(r.segment)).toEqual({ ok: true });
    }
  });
});

// must_catch 的具名測試:每條一個,字串用 \u 跳脫寫真碼位,不靠編輯器保留分解形式。
describe('must_catch(T6 檔頭逐條)', () => {
  it('放行 C++', async () => {
    expect(await loadValidator().then((v) => v('C++'))).toEqual({ ok: false, rule: 'charset' });
  });
  it('放行非 NFC:U+1100 U+1161', async () => {
    expect(await loadValidator().then((v) => v('\u1100\u1161'))).toEqual({ ok: false, rule: 'nfc' });
  });
  it('放行非 NFC:U+F900', async () => {
    expect(await loadValidator().then((v) => v('\uf900'))).toEqual({ ok: false, rule: 'nfc' });
  });
  it('放行非 NFC:e + U+0301', async () => {
    expect(await loadValidator().then((v) => v('e\u0301'))).toEqual({ ok: false, rule: 'nfc' });
  });
  it('放行結尾的點(a.)', async () => {
    expect(await loadValidator().then((v) => v('a.'))).toEqual({ ok: false, rule: 'trailing-dot' });
  });
  it('放行開頭的點(.hidden)', async () => {
    expect(await loadValidator().then((v) => v('.hidden'))).toEqual({ ok: false, rule: 'leading-dot' });
  });
  it('放行 Windows 保留名:nul、COM9、COM\u00b9', async () => {
    const v = await loadValidator();
    expect(v('nul')).toEqual({ ok: false, rule: 'reserved' });
    expect(v('COM9')).toEqual({ ok: false, rule: 'reserved' });
    expect(v('COM\u00b9')).toEqual({ ok: false, rule: 'reserved' });
  });
  it('放行 65 位元組(21 個 U+AC00 加 ab 是 65 位元組;64 位元組要放行)', async () => {
    const v = await loadValidator();
    expect(v('\uac00'.repeat(21) + 'ab')).toEqual({ ok: false, rule: 'length' });
    expect(v('\uac00'.repeat(21) + 'a')).toEqual({ ok: true });
    expect(v('a'.repeat(65))).toEqual({ ok: false, rule: 'length' });
    expect(v('a'.repeat(64))).toEqual({ ok: true });
  });
  it('正向對照:Security 與 \u30bb\u30ad\u30e5\u30ea\u30c6\u30a3\u30fc(結尾 U+30FC)放行', async () => {
    const v = await loadValidator();
    expect(v('Security')).toEqual({ ok: true });
    expect(v('\u30bb\u30ad\u30e5\u30ea\u30c6\u30a3\u30fc')).toEqual({ ok: true });
  });
});
