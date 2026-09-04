/**
 * 登記表的守門。
 *
 * 這個檔存在的理由是 phase-2 第一次交付時發生過的事:框架寫完了、1508 個測試全綠、
 * 變異分數也過門檻,但 registry 只登記了 Wave 0 的一組 demo,`packages/core/prompts/`
 * 底下五個真的 prompt 檔一個都沒被引用。照那樣跑 `--live` 會產生一個看起來像基準、
 * 實際上什麼都沒鎖住的檔案:之後改了 `cards.md` 再 `--diff`,會拿到「沒有變化」,
 * 因為根本沒在比那個 prompt。
 *
 * **所以「有沒有接上真的東西」要是紅燈,不是靠下一個人記得問。**
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  allGoldenSets,
  checkPromptCoverage,
  getGoldenSet,
  listGoldenSets,
  PROMPTS_DIR,
  REAL_TASK_GOLDEN_SET_IDS,
  scanPromptFiles,
} from './registry.js';
import { RAW_SLICES, sliceBody, sliceRaw, type RawSlice } from './raw-slices.js';
import type { GoldenSet, GoldenSetId, LlmTask } from '../types.js';

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

const ROOT = resolve(import.meta.dirname, '../../../../..');

/** 契約 §7 的權威清單。登記表的 task 只能是這七個之一。 */
const CONTRACT_LLM_TASKS = [
  'ingest.cards',
  'ingest.questions',
  'ingest.deps',
  'deepen',
  'grade.fill.llm',
  'grade.apply',
  'reteach.short',
];

describe('prompt 檔的守門', () => {
  it('每一個 prompt 檔都被某個 golden set 的 promptFile 引用', () => {
    const coverage = checkPromptCoverage();
    expect(coverage.unregistered).toEqual([]);
  });

  it('掃到 0 個 prompt 檔要當成壞掉,不是「很乾淨」(P-28)', () => {
    const coverage = checkPromptCoverage('packages/core/prompts/這個目錄不存在');
    expect(coverage.scanned).toEqual([]);
    expect(coverage.scannerBroken).toBe(true);
  });

  it('掃到東西的時候 scannerBroken 是 false——旗子不是永遠亮著', () => {
    expect(checkPromptCoverage().scannerBroken).toBe(false);
  });

  it('登記表指到的 prompt 檔都真的存在', () => {
    expect(checkPromptCoverage().missing).toEqual([]);
    for (const set of allGoldenSets()) {
      expect(existsSync(join(ROOT, set.promptFile))).toBe(true);
    }
  });

  it('掃描器找得到 ingest 底下那五個檔,而且路徑是 repo 相對、用 / 分隔', () => {
    expect(scanPromptFiles()).toEqual([
      `${PROMPTS_DIR}/ingest/cards.md`,
      `${PROMPTS_DIR}/ingest/children.md`,
      `${PROMPTS_DIR}/ingest/deps.md`,
      `${PROMPTS_DIR}/ingest/questions.md`,
      `${PROMPTS_DIR}/ingest/regenerate.md`,
    ]);
  });

  /**
   * 反向驗證:多一個沒登記的 prompt 檔就要被抓出來。
   * 真的在 repo 裡放一個假檔來驗會動到 `prompts/`(CLAUDE.md 硬規則 4:改了要跑 golden run),
   * 所以這裡用「掃描結果 − 登記」的定義本身來驗——同一個判斷,不碰那個資料夾。
   */
  it('多一個沒被登記的 prompt 檔,unregistered 就會列出它', () => {
    const referenced = new Set(allGoldenSets().map((s) => s.promptFile));
    const probe = `${PROMPTS_DIR}/ingest/_probe.md`;
    expect(referenced.has(probe)).toBe(false);
    const scanned = [...scanPromptFiles(), probe];
    expect(scanned.filter((f) => !referenced.has(f))).toEqual([probe]);
  });

  it('現在的登記表沒有任何 prompt 檔被兩組以上指到', () => {
    expect(checkPromptCoverage().duplicated).toEqual([]);
  });

  /**
   * 反向驗證的**另一個方向**。第一個方向(引用數 0)上面已經驗過了。
   *
   * 這一個方向 `unregistered` 抓不到:selftest 改成也指 `cards.md` 之後,
   * 五個檔仍然「每個都有人引用」,掃描器會全綠——可是 selftest 的基準其實在評
   * `cards.md`,改了它自己的 prompt 檔沒有人在看。所以要另外數引用數。
   */
  it('兩組 golden set 指到同一個 prompt 檔就要紅,即使沒有任何檔變成沒人引用', () => {
    const shared = `${PROMPTS_DIR}/ingest/cards.md`;
    const sets = allGoldenSets().map((s) => (s.id === 'selftest' ? { ...s, promptFile: shared } : s));

    const coverage = checkPromptCoverage(PROMPTS_DIR, sets);

    // 先證明舊的兩項檢查在這個情境下都是綠的——所以它們不足以守住
    expect(coverage.unregistered).toEqual([]);
    expect(coverage.missing).toEqual([]);
    expect(coverage.scannerBroken).toBe(false);

    // 新的這一項才紅
    expect(coverage.duplicated).toEqual([{ promptFile: shared, sets: ['ingest.cards', 'selftest'] }]);
  });

  it('三組指到同一個檔會列出三個 set id,依字典序', () => {
    const shared = `${PROMPTS_DIR}/ingest/deps.md`;
    const sets = allGoldenSets().map((s) =>
      s.id === 'selftest' || s.id === 'ingest.questions' ? { ...s, promptFile: shared } : s,
    );
    const dup = checkPromptCoverage(PROMPTS_DIR, sets).duplicated;
    expect(dup).toEqual([{ promptFile: shared, sets: ['ingest.deps', 'ingest.questions', 'selftest'] }]);
  });

  /**
   * 排序要真的被驗到,就得讓**登記表的順序跟字典序相反**——
   * 順序本來就對的話,把 `.sort()` 拿掉一樣會過(變異測試抓到過這件事)。
   * 這裡 `questions.md` 先出現、`cards.md` 後出現,輸出必須反過來。
   */
  it('兩個檔各自被重複指到時,duplicated 依 promptFile 字典序排(不是照登記順序)', () => {
    const cards = `${PROMPTS_DIR}/ingest/cards.md`;
    const questions = `${PROMPTS_DIR}/ingest/questions.md`;
    const base = allGoldenSets();
    const pick = (id: string): GoldenSet => base.find((s) => s.id === id)!;
    // 登記順序刻意反著排:questions 那一對在前、cards 那一對在後
    const sets: GoldenSet[] = [
      { ...pick('ingest.questions'), promptFile: questions },
      { ...pick('selftest'), promptFile: questions },
      { ...pick('ingest.cards'), promptFile: cards },
      { ...pick('ingest.children'), promptFile: cards },
      { ...pick('ingest.regenerate'), promptFile: `${PROMPTS_DIR}/ingest/regenerate.md` },
      { ...pick('ingest.deps'), promptFile: `${PROMPTS_DIR}/ingest/deps.md` },
    ];
    expect(checkPromptCoverage(PROMPTS_DIR, sets).duplicated.map((d) => d.promptFile)).toEqual([cards, questions]);
  });

  /**
   * 掃描結果要排序。
   *
   * **誠實記錄**:這個測試殺不掉「把 `.sort()` 拿掉」那個變異——實測過,
   * 三十個檔在這台機器的檔案系統上 `readdirSync` 本來就回傳排好的順序。
   * `.sort()` 仍然要留著(POSIX 不保證讀取順序),所以那是一個**在這個平台上的等價變異**,
   * 不是缺測試。這個測試釘住的是「輸出是排序的」這個對外承諾。
   */
  it('掃描結果依字典序,不是依目錄的讀取順序', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pq-scan-'));
    tmpDirs.push(dir);
    mkdirSync(join(dir, 'nested'), { recursive: true });
    const names: string[] = [];
    for (let i = 0; i < 30; i++) {
      const name = `${String(i).padStart(2, '0')}-${(i * 7919) % 997}.md`;
      names.push(name);
      writeFileSync(join(dir, i % 2 === 0 ? name : join('nested', name)), '# x\n');
    }
    const scanned = scanPromptFiles(dir);
    expect(scanned).toHaveLength(30);
    expect(scanned).toEqual([...scanned].sort());
    // 巢狀目錄的檔也在裡面,而且路徑是用 / 分隔的
    expect(scanned.some((p) => p.includes('/nested/'))).toBe(true);
  });

  it('promptsDir 給絕對路徑時就當絕對路徑用,空目錄是「掃到 0 個」不是「目錄不存在」', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pq-empty-'));
    tmpDirs.push(dir);
    expect(existsSync(dir)).toBe(true);
    const coverage = checkPromptCoverage(dir, []);
    expect(coverage.scanned).toEqual([]);
    expect(coverage.scannerBroken).toBe(true);
  });
});

/**
 * 型別層的守門:`GoldenSetId` 與 `LlmTask` 是兩個**不同的別名**,
 * 把 set id 當任務傳(或反過來)要在編譯期就被擋下來,不是靠人記得。
 *
 * 這些 `@ts-expect-error` 是真的斷言:如果哪天誰把 `GoldenSetId` 改成 `string`、
 * 或者把兩個別名合併,錯誤就消失了,`@ts-expect-error` 自己會變成
 * 「Unused '@ts-expect-error' directive」——`npm run typecheck` 會紅。
 *
 * 已知的邊界(刻意的,不是漏掉):三個字串在兩邊都合法
 * (`ingest.cards` / `ingest.questions` / `ingest.deps`),因為那三組的 set id 與 task
 * 本來就是同一個字。真正會出事的那幾個(`ingest.children` / `ingest.regenerate` /
 * `selftest` 沒有對應任務,`deepen` 等四個任務沒有對應 set)全部被擋住。
 */
describe('GoldenSetId 與 LlmTask 在型別上分得開', () => {
  it('set id 不能當 LlmTask 用(反過來也不行)', () => {
    // @ts-expect-error set id 的聯集不是 LlmTask 的子集
    const asTask: LlmTask = null as unknown as GoldenSetId;
    // @ts-expect-error LlmTask 的聯集也不是 set id 的子集
    const asSet: GoldenSetId = null as unknown as LlmTask;
    // @ts-expect-error 'ingest.children' 不在契約 §7 裡
    const childrenIsNotATask: LlmTask = 'ingest.children';
    // @ts-expect-error 'ingest.regenerate' 不在契約 §7 裡
    const regenerateIsNotATask: LlmTask = 'ingest.regenerate';
    // @ts-expect-error 'selftest' 不在契約 §7 裡
    const selftestIsNotATask: LlmTask = 'selftest';
    // @ts-expect-error 'deepen' 沒有對應的 golden set
    const deepenIsNotASet: GoldenSetId = 'deepen';
    // 這個測試的價值在編譯期,執行期只要跑得完就好
    expect([asTask, asSet, childrenIsNotATask, regenerateIsNotATask, selftestIsNotATask, deepenIsNotASet]).toHaveLength(6);
  });
});

describe('登記表本身', () => {
  it('五個真的 ingest 任務加一組自我測試', () => {
    expect(listGoldenSets().sort()).toEqual([
      'ingest.cards',
      'ingest.children',
      'ingest.deps',
      'ingest.questions',
      'ingest.regenerate',
      'selftest',
    ]);
    expect([...REAL_TASK_GOLDEN_SET_IDS].sort()).toEqual([
      'ingest.cards',
      'ingest.children',
      'ingest.deps',
      'ingest.questions',
      'ingest.regenerate',
    ]);
  });

  it('selftest 不算真實任務——05 尚未提供 prompt 檔,grade.apply 的真實登記待 05', () => {
    expect(REAL_TASK_GOLDEN_SET_IDS).not.toContain('selftest');
    const selftest = getGoldenSet('selftest')!;
    expect(selftest.task).toBe('grade.apply');
    expect(selftest.promptFile.startsWith(PROMPTS_DIR)).toBe(false);
  });

  it('每個 set 的 id 就是它在登記表裡的 key', () => {
    for (const id of listGoldenSets()) expect(getGoldenSet(id)!.id).toBe(id);
  });

  it('task 只能是契約 §7 的七個值之一(登記表不發明任務名)', () => {
    for (const set of allGoldenSets()) expect(CONTRACT_LLM_TASKS).toContain(set.task);
  });

  /**
   * 契約 §7 沒有 `ingest.children`、也沒有 `regenerate`:
   * `children.ts:126` 與 `generate-cards.ts` 的 regenerate 走的都是 `'ingest.cards'`。
   * 一個 prompt 檔一組 golden set,所以三組共用同一個 task——這是**刻意的**,
   * 也是登記表不能用 LlmTask 當 key 的原因。
   */
  it('cards / children / regenerate 三組都送 ingest.cards,但各自有自己的 prompt 檔', () => {
    const ids = ['ingest.cards', 'ingest.children', 'ingest.regenerate'] as const;
    const sets = ids.map((id) => getGoldenSet(id)!);
    expect(sets.map((s) => s.task)).toEqual(['ingest.cards', 'ingest.cards', 'ingest.cards']);
    expect(new Set(sets.map((s) => s.promptFile)).size).toBe(3);
  });

  it('每組三個輸入(FEATURE.md 開放問題:先每個任務 3 個輸入)', () => {
    for (const set of allGoldenSets()) expect(set.inputs.length).toBe(3);
  });

  it('輸入 id 在整張表裡唯一——id 是檔名,撞名會互相蓋掉輸出檔', () => {
    const ids = allGoldenSets().flatMap((s) => s.inputs.map((i) => `${s.id}/${i.id}`));
    expect(new Set(ids).size).toBe(ids.length);
    for (const set of allGoldenSets()) {
      expect(new Set(set.inputs.map((i) => i.id)).size).toBe(set.inputs.length);
    }
  });

  /**
   * FakeLlmRouter 靠 `prompt_contains` 對 fixture,而它是先 filter 再拿 `candidates[0]`
   * 的標記當群組。同一個 task 底下兩個輸入如果互相包含對方的標記,`--fake` 會靜靜地
   * 回錯的那一份。`golden: <input id>` 這行就是為此存在,這裡驗它真的唯一。
   */
  it('同一個 task 底下,沒有任何一則輸入的 golden 標記是另一則的子字串', () => {
    for (const set of allGoldenSets()) {
      if (set.id === 'selftest') continue;
      for (const input of set.inputs) {
        expect(input.prompt).toContain(`golden: ${input.id}`);
      }
    }
    const byTask = new Map<string, string[]>();
    for (const set of allGoldenSets()) {
      for (const input of set.inputs) {
        byTask.set(set.task, [...(byTask.get(set.task) ?? []), input.id]);
      }
    }
    for (const [, ids] of byTask) {
      for (const a of ids) {
        for (const b of ids) {
          if (a !== b) expect(`golden: ${a}`.includes(`golden: ${b}`)).toBe(false);
        }
      }
    }
  });

  it('五組真任務的輸入全部來自 raw fixture 的三個切片,沒有自己編的例子', () => {
    for (const id of REAL_TASK_GOLDEN_SET_IDS) {
      const set = getGoldenSet(id)!;
      // deps 吃的是卡片清單,形狀跟另外四組不同,所以比對的是切片標題
      const needles = RAW_SLICES.map((s) => (id === 'ingest.deps' ? s.heading : s.key));
      const joined = set.inputs.map((i) => i.prompt).join('\n');
      for (const n of needles) expect(joined).toContain(n);
    }
  });

  it('三份 deps 清單的長度與順序刻意不同(3 張、2 張、倒過來的 3 張)', () => {
    const inputs = getGoldenSet('ingest.deps')!.inputs;
    const cardLines = (p: string): string[] => p.split('\n').filter((l) => l.startsWith('- '));
    expect(cardLines(inputs[0]!.prompt).length).toBe(3);
    expect(cardLines(inputs[1]!.prompt).length).toBe(2);
    expect(cardLines(inputs[2]!.prompt)).toEqual([...cardLines(inputs[0]!.prompt)].reverse());
  });
});

/**
 * 逐字釘住每一組的第一則輸入。
 *
 * 為什麼要到逐字:這些字串**就是登記的資料本身**。header 少一行、`---` 換成別的、
 * `category` 打錯,`--live` 照樣跑得完、也照樣產出一個看起來像基準的檔案——
 * 錯的地方要到有人比對 02 真的送出去的 prompt 時才會發現。`toContain` 抓不到這種事。
 *
 * header 照 02-ingest-pipeline 的四個 builder,多一行 `golden: <input id>`
 * (`--fake` 的 fixture 靠它對位,理由見 registry.ts)。
 */
describe('每一組的第一則輸入逐字長這樣', () => {
  const first = (id: Parameters<typeof getGoldenSet>[0]): string => getGoldenSet(id)!.inputs[0]!.prompt;
  const slice = (key: RawSlice['key']): RawSlice => RAW_SLICES.find((s) => s.key === key)!;

  it('ingest.cards:category + source,內容是含 ## 標題的整段切片', () => {
    expect(first('ingest.cards')).toBe(
      [
        '---',
        'golden: cards-same-origin',
        'category: security',
        'source: security-basics.md',
        '---',
        sliceRaw(slice('same-origin')),
      ].join('\n'),
    );
  });

  it('ingest.children:parent_id + parent_title,內容是去掉標題的父卡正文', () => {
    expect(first('ingest.children')).toBe(
      [
        '---',
        'golden: children-same-origin',
        'parent_id: sec-golden-same-origin',
        'parent_title: 同源政策',
        '---',
        sliceBody(slice('same-origin')),
      ].join('\n'),
    );
  });

  it('ingest.regenerate:title + limit + previous body 攤成一行,沒有結尾的 ---', () => {
    expect(first('ingest.regenerate')).toBe(
      [
        '---',
        'golden: regenerate-same-origin',
        'category: security',
        'source: security-basics.md',
        'title: 同源政策',
        'limit: 100',
        `previous body: ${sliceBody(slice('same-origin')).replace(/\n/g, ' ')}`,
      ].join('\n'),
    );
    expect(first('ingest.regenerate').endsWith('---')).toBe(false);
  });

  it('ingest.questions:card + title,內容是那張卡的 body', () => {
    expect(first('ingest.questions')).toBe(
      [
        '---',
        'golden: questions-same-origin',
        'card: sec-golden-same-origin',
        'title: 同源政策',
        '---',
        sliceBody(slice('same-origin')),
      ].join('\n'),
    );
  });

  it('ingest.deps:category 後面空一行再列 cards,每張一行 `- id: title`', () => {
    expect(first('ingest.deps')).toBe(
      [
        '---',
        'golden: deps-three-sections',
        'category: security',
        '',
        'cards:',
        '- sec-golden-same-origin: 同源政策',
        '- sec-golden-cors: 跨來源資源共享',
        '- sec-golden-preflight: 預檢請求',
      ].join('\n'),
    );
  });
});

describe('掃描器與守門的邊界', () => {
  /**
   * 只撿 `.md`。拿一個同時有 `.md` 與別種副檔名的目錄來掃:
   * 條件放寬成「什麼都收」的話,這裡會多出一堆 `.json`。
   */
  it('只撿 .md,別的副檔名不算 prompt 檔', () => {
    expect(scanPromptFiles('contracts/fixtures/llm')).toEqual(['contracts/fixtures/llm/README.md']);
  });

  it('登記表指到 promptsDir 底下不存在的檔時,missing 列出它', () => {
    const coverage = checkPromptCoverage(PROMPTS_DIR, [
      { id: 'ingest.cards', task: 'ingest.cards', promptFile: `${PROMPTS_DIR}/ingest/沒了.md`, inputs: [] },
    ]);
    expect(coverage.missing).toEqual([`${PROMPTS_DIR}/ingest/沒了.md`]);
  });

  /**
   * `missing` 只管 promptsDir 底下的檔。selftest 的佔位 prompt 在
   * `golden-sets/` 底下,不在掃描範圍內,不能因為「掃描結果裡沒有它」就報失蹤。
   */
  it('promptsDir 以外的 promptFile 不算失蹤(selftest 的佔位檔就在外面)', () => {
    expect(checkPromptCoverage().missing).toEqual([]);
    const outside = 'packages/core/src/prompt-quality/golden-sets/grade.apply.selftest-prompt.md';
    expect(getGoldenSet('selftest')!.promptFile).toBe(outside);
  });

  it('missing 依字典序,清單才 diff 得起來', () => {
    const coverage = checkPromptCoverage(PROMPTS_DIR, [
      { id: 'ingest.cards', task: 'ingest.cards', promptFile: `${PROMPTS_DIR}/zzz.md`, inputs: [] },
      { id: 'ingest.deps', task: 'ingest.deps', promptFile: `${PROMPTS_DIR}/aaa.md`, inputs: [] },
    ]);
    expect(coverage.missing).toEqual([`${PROMPTS_DIR}/aaa.md`, `${PROMPTS_DIR}/zzz.md`]);
  });

  it('沒有任何 golden set 時,掃到的每個檔都是未登記', () => {
    const coverage = checkPromptCoverage(PROMPTS_DIR, []);
    expect(coverage.unregistered).toEqual(scanPromptFiles());
    expect(coverage.missing).toEqual([]);
  });
});
