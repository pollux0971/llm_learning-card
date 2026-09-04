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
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
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
