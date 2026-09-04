/**
 * phase-2 的兩項批次結構性檢查:重複率與圖形狀。
 *
 * 兩件事在這裡被釘死,因為它們是變異測試最愛殺的地方:
 *   1. **閾值邊界**:剛好 0.6 算不算重複。答案是「算」(>=),見下面兩個 boundary 測試。
 *   2. **level 的方向**:prereq 的 level 比自己**深**才算違規,同層與往回都不算。
 */
import { describe, it, expect } from 'vitest';
import {
  DUPLICATE_BODY_JACCARD_THRESHOLD,
  DUPLICATE_NGRAM_SIZE,
  charNgrams,
  checkDuplicates,
  checkPrereqShape,
  jaccard,
  normalizeBody,
  normalizeTitle,
  runBatchChecks,
  QUALITY_NOTE,
} from './structural-checks.js';
import { I1_SECURITY_BATCH } from './fixtures/i1-security-batch.js';
import {
  BOUNDARY_BODY_A as BOUNDARY_A,
  BOUNDARY_BODY_EXACTLY_AT as BOUNDARY_EXACTLY_060,
  BOUNDARY_BODY_JUST_BELOW as BOUNDARY_JUST_BELOW,
  FOUR_DUPLICATE_PAIRS,
  FOUR_DUPLICATE_PAIRS_EXPECTED,
  NO_DUPLICATES,
  batchCard as card,
} from './fixtures/synthetic-batches.js';

describe('常數集中在一處', () => {
  it('閾值與 n-gram 大小是可設定的常數,不散在程式裡', () => {
    expect(DUPLICATE_BODY_JACCARD_THRESHOLD).toBe(0.6);
    expect(DUPLICATE_NGRAM_SIZE).toBe(3);
  });
});

describe('normalizeTitle', () => {
  it('大小寫不影響', () => {
    expect(normalizeTitle('CORS 預檢請求')).toBe(normalizeTitle('cors 預檢請求'));
  });

  it('空白不影響,含全形空白 U+3000 與換行', () => {
    expect(normalizeTitle('CORS 預檢請求')).toBe(normalizeTitle('CORS　預\n檢 請求'));
  });

  it('全形英數與半形視為同一個字(NFKC)', () => {
    expect(normalizeTitle('ＣＯＲＳ預檢請求')).toBe(normalizeTitle('CORS預檢請求'));
  });

  it('標點與符號被剝掉', () => {
    expect(normalizeTitle('CORS-預檢請求')).toBe(normalizeTitle('「CORS 預檢請求」'));
  });

  it('包含關係不算相同——「預檢請求」不等於「CORS 預檢請求」', () => {
    expect(normalizeTitle('預檢請求')).not.toBe(normalizeTitle('CORS 預檢請求'));
  });
});

describe('normalizeBody', () => {
  it('移除 example 圍欄(契約 §2:圍欄不算字數,也不參與重複率比對)', () => {
    const withFence = '正文內容\n\n```example\n只出現在圍欄裡的字\n```\n';
    expect(normalizeBody(withFence)).toBe(normalizeBody('正文內容'));
    expect(normalizeBody(withFence)).not.toContain('只出現在圍欄裡的字');
  });

  it('大小寫與空白不影響', () => {
    expect(normalizeBody('CORS  讓前端\n協作')).toBe(normalizeBody('cors讓前端協作'));
  });

  it('**保留**標點——標點在正文裡帶訊息,剝掉會灌水相似度', () => {
    expect(normalizeBody('協定、主機、埠號')).toContain('、');
  });
});

describe('charNgrams / jaccard', () => {
  it('n-gram 依 n 切,預設 3', () => {
    expect([...charNgrams('abcd')].sort()).toEqual(['abc', 'bcd']);
    expect([...charNgrams('abcd', 2)].sort()).toEqual(['ab', 'bc', 'cd']);
  });

  it('字串短於 n 時回傳整個字串當唯一一個 gram,不是空集合', () => {
    expect([...charNgrams('ab')]).toEqual(['ab']);
  });

  it('完全相同是 1,完全不同是 0', () => {
    expect(jaccard(charNgrams('abcdef'), charNgrams('abcdef'))).toBe(1);
    expect(jaccard(charNgrams('abcdef'), charNgrams('uvwxyz'))).toBe(0);
  });

  it('兩邊都空定義為 0(沒有內容就沒有重複可言)', () => {
    expect(jaccard(new Set(), new Set())).toBe(0);
  });

  it('邊界字串的相似度剛好是 0.6', () => {
    expect(jaccard(charNgrams(BOUNDARY_A), charNgrams(BOUNDARY_EXACTLY_060))).toBeCloseTo(0.6, 10);
  });

  it('差一格的字串在門檻之下', () => {
    const j = jaccard(charNgrams(BOUNDARY_A), charNgrams(BOUNDARY_JUST_BELOW));
    expect(j).toBeLessThan(DUPLICATE_BODY_JACCARD_THRESHOLD);
    expect(j).toBeCloseTo(6 / 11, 10);
  });
});

describe('checkDuplicates:閾值邊界', () => {
  it('剛好等於 0.6 **算**一對重複(判定是 >=,不是 >)', () => {
    const report = checkDuplicates([card('a-0001', '標題一', BOUNDARY_A), card('a-0002', '標題二', BOUNDARY_EXACTLY_060)]);
    expect(report.pairs).toEqual([{ a: 'a-0001', b: 'a-0002', reason: 'body', similarity: expect.closeTo(0.6, 10) }]);
  });

  it('差一格(0.545)不算重複', () => {
    const report = checkDuplicates([card('a-0001', '標題一', BOUNDARY_A), card('a-0002', '標題二', BOUNDARY_JUST_BELOW)]);
    expect(report.pairs).toEqual([]);
  });

  it('閾值可以從外面調——調到 0.5 之後那一對就被抓到了', () => {
    const cards = [card('a-0001', '標題一', BOUNDARY_A), card('a-0002', '標題二', BOUNDARY_JUST_BELOW)];
    expect(checkDuplicates(cards, { threshold: 0.5 }).pairs).toHaveLength(1);
  });
});

describe('checkDuplicates:正面', () => {
  const FOUR_PAIRS = FOUR_DUPLICATE_PAIRS;

  it('算得出 4 對,清單正確,且依 (a, b) 字典序', () => {
    const report = checkDuplicates(FOUR_PAIRS);
    expect(report.pairs.map((p) => [p.a, p.b])).toEqual(FOUR_DUPLICATE_PAIRS_EXPECTED);
  });

  it('標題相同的那兩對 reason 是 title,body 相似的那兩對是 body', () => {
    const byPair = Object.fromEntries(checkDuplicates(FOUR_PAIRS).pairs.map((p) => [`${p.a}/${p.b}`, p.reason]));
    expect(byPair['syn-0001/syn-0002']).toBe('title');
    expect(byPair['syn-0003/syn-0004']).toBe('title');
    expect(byPair['syn-0005/syn-0006']).toBe('body');
    expect(byPair['syn-0007/syn-0008']).toBe('body');
  });

  it('輸出的是「重複對數 / 卡數」', () => {
    const report = checkDuplicates(FOUR_PAIRS);
    expect(report.cardCount).toBe(10);
    expect(report.pairs).toHaveLength(4);
    expect(report.rate).toBeCloseTo(0.4, 10);
  });

  it('同一對只算一次,不會因為標題與 body 都命中就算兩次', () => {
    const both = [card('d-0001', '一樣的標題', BOUNDARY_A), card('d-0002', '一樣的標題', BOUNDARY_A)];
    const report = checkDuplicates(both);
    expect(report.pairs).toHaveLength(1);
    expect(report.pairs[0]!.reason).toBe('title'); // 標題優先:那是更強的證據
  });
});

describe('checkDuplicates:負面', () => {
  it('完全不重複的一批算出 0 對,rate 是 0', () => {
    const report = checkDuplicates(NO_DUPLICATES);
    expect(report.pairs).toEqual([]);
    expect(report.cardCount).toBe(3);
    expect(report.rate).toBe(0);
  });

  it('空的一批不會除以 0', () => {
    expect(checkDuplicates([])).toEqual({ cardCount: 0, pairs: [], rate: 0 });
  });

  it('只有一張卡沒有「兩兩比」可言', () => {
    expect(checkDuplicates([card('s-0001', '只有一張', '內容')]).pairs).toEqual([]);
  });
});

describe('checkDuplicates:I1 真實資料的基準', () => {
  it('25 張卡,在門檻 0.6 之下是 **0 對** —— 這就是 golden 要守住的基準', () => {
    const report = checkDuplicates(I1_SECURITY_BATCH);
    expect(report.cardCount).toBe(25);
    expect(report.pairs).toEqual([]);
    expect(report.rate).toBe(0);
  });

  it('標題正規化後沒有任何一對相同', () => {
    const titles = I1_SECURITY_BATCH.map((c) => normalizeTitle(c.title));
    expect(new Set(titles).size).toBe(25);
  });

  /**
   * 這個測試把「為什麼 I1 的 4 對抓不到」釘住,免得之後有人看到 0 對就以為檢查壞了。
   *
   * I1-REVIEW §8.1 那 4 對是**語意**近重複(「預檢請求」與「CORS 預檢請求」講同一件事、
   * 但用字不同),字元 3-gram 抓的是字面重複。實測(2026-09-04):
   *   sec-0007/sec-0015 = 0.132   sec-0006/sec-0016 = 0.082
   *   sec-0003/sec-0013 = 0.057   sec-0003/sec-0014 = 0.019
   * 而 25 張兩兩共 300 對裡最高的是 sec-0019/sec-0021 = 0.357,**不在那 4 對裡**。
   * 也就是說沒有任何閾值能把人判的那 4 對挑出來而不誤報一堆。
   * 那 4 對屬於人打分的兩個維度,不屬於這個機器指標(ADR-032:工具不判斷品質)。
   */
  it('人判的那 4 對每一對都在門檻之下,而且分數低於一堆沒被點名的對', () => {
    const sim = (a: string, b: string): number => {
      const ca = I1_SECURITY_BATCH.find((c) => c.id === a)!;
      const cb = I1_SECURITY_BATCH.find((c) => c.id === b)!;
      return jaccard(charNgrams(normalizeBody(ca.body)), charNgrams(normalizeBody(cb.body)));
    };
    for (const [a, b] of [
      ['sec-0007', 'sec-0015'],
      ['sec-0006', 'sec-0016'],
      ['sec-0003', 'sec-0013'],
      ['sec-0003', 'sec-0014'],
    ] as const) {
      expect(sim(a, b)).toBeLessThan(DUPLICATE_BODY_JACCARD_THRESHOLD);
    }
    // 沒被人點名、但字面上更像的一對,分數高於上面每一對
    expect(sim('sec-0019', 'sec-0021')).toBeGreaterThan(sim('sec-0007', 'sec-0015'));
  });

  it('把門檻調到 0.35 就抓得到東西,證明指標本身會動', () => {
    const report = checkDuplicates(I1_SECURITY_BATCH, { threshold: 0.35 });
    expect(report.pairs.map((p) => [p.a, p.b])).toEqual([['sec-0019', 'sec-0021']]);
  });
});

describe('checkPrereqShape', () => {
  it('L0 卡的 prereq 含 L1 卡會被列出來', () => {
    const cards = [card('g-0001', '主卡', '正文', 0, ['g-0002']), card('g-0002', '子卡', '正文', 1, [])];
    expect(checkPrereqShape(cards)).toEqual([{ card: 'g-0001', cardLevel: 0, prereq: 'g-0002', prereqLevel: 1 }]);
  });

  it('正常方向的 L1 → L0 不誤報', () => {
    const cards = [card('g-0001', '主卡', '正文', 0, []), card('g-0002', '子卡', '正文', 1, ['g-0001'])];
    expect(checkPrereqShape(cards)).toEqual([]);
  });

  it('同層互指不算違規(只有「更深」才算)', () => {
    const cards = [card('g-0001', '甲', '正文', 1, ['g-0002']), card('g-0002', '乙', '正文', 1, [])];
    expect(checkPrereqShape(cards)).toEqual([]);
  });

  it('目標 0:一批形狀正常的卡回傳空陣列', () => {
    const cards = [
      card('g-0001', '主卡一', '正文', 0, []),
      card('g-0002', '主卡二', '正文', 0, ['g-0001']),
      card('g-0003', '子卡', '正文', 1, ['g-0001', 'g-0002']),
    ];
    expect(checkPrereqShape(cards)).toEqual([]);
  });

  it('prereq 指向不存在的 id 不在這裡報(那是 09-lint 的斷鏈檢查)', () => {
    const cards = [card('g-0001', '主卡', '正文', 0, ['g-9999'])];
    expect(checkPrereqShape(cards)).toEqual([]);
  });

  it('prereqs 省略時當作空陣列', () => {
    expect(checkPrereqShape([{ id: 'g-0001', title: '主卡', level: 0, body: '正文' }])).toEqual([]);
  });

  /**
   * I1-REVIEW §8.2 只點名了 sec-0003 → sec-0011 一筆,實際掃 25 張是 **4 筆**。
   * 目標是 0 筆,所以這 4 筆就是要被打掉的基準。
   */
  it('I1 真實資料掃出 4 筆,依 card 再 prereq 字典序', () => {
    expect(checkPrereqShape(I1_SECURITY_BATCH)).toEqual([
      { card: 'sec-0003', cardLevel: 0, prereq: 'sec-0011', prereqLevel: 1 },
      { card: 'sec-0004', cardLevel: 0, prereq: 'sec-0012', prereqLevel: 1 },
      { card: 'sec-0007', cardLevel: 0, prereq: 'sec-0022', prereqLevel: 1 },
      { card: 'sec-0008', cardLevel: 0, prereq: 'sec-0023', prereqLevel: 1 },
    ]);
  });
});

describe('runBatchChecks', () => {
  it('兩項的結果都進既有的 StructuralIssue 體系,note 仍然是那句提醒', () => {
    const cards = [
      card('b-0001', '一樣的標題', BOUNDARY_A, 0, ['b-0003']),
      card('b-0002', '一樣的標題', '完全不同的正文,只有標題撞名。'),
      card('b-0003', '子卡', '子卡正文', 1, []),
    ];
    const result = runBatchChecks(cards);
    expect(result.issues.map((i) => i.kind).sort()).toEqual(['duplicate-pair', 'prereq-shape']);
    expect(result.note).toBe(QUALITY_NOTE);
    expect(result.duplicates.pairs).toHaveLength(1);
    expect(result.prereqShape).toHaveLength(1);
  });

  it('每一對重複、每一筆圖形狀各一筆 issue', () => {
    const cards = [
      card('b-0001', '甲', BOUNDARY_A, 0, ['b-0004', 'b-0005']),
      card('b-0002', '乙', BOUNDARY_EXACTLY_060),
      card('b-0003', '甲', '跟第一張標題一樣'),
      card('b-0004', '子卡一', '正文一', 1, []),
      card('b-0005', '子卡二', '正文二', 1, []),
    ];
    const result = runBatchChecks(cards);
    const kinds = result.issues.map((i) => i.kind);
    expect(kinds.filter((k) => k === 'duplicate-pair')).toHaveLength(result.duplicates.pairs.length);
    expect(kinds.filter((k) => k === 'prereq-shape')).toHaveLength(2);
  });

  it('I1 真實資料:0 對重複、4 筆圖形狀', () => {
    const result = runBatchChecks(I1_SECURITY_BATCH);
    expect(result.duplicates.pairs).toEqual([]);
    expect(result.prereqShape).toHaveLength(4);
    expect(result.issues.map((i) => i.kind)).toEqual(Array(4).fill('prereq-shape'));
  });

  it('乾淨的一批沒有任何 issue', () => {
    const cards = [card('c-0001', '甲', 'ABCDEFGH 甲的正文', 0, []), card('c-0002', '乙', 'qrstuvwx 乙的正文', 1, ['c-0001'])];
    expect(runBatchChecks(cards).issues).toEqual([]);
  });
});
