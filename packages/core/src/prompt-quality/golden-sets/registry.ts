/**
 * golden set 登記表:一個 prompt 檔一組固定輸入
 * (FEATURE.md「開放問題」:先每個任務 3 個輸入)。
 *
 * ## key 是 golden set id,不是 LlmTask
 *
 * 契約 §7 的 `LlmTask` 只有 7 個值,而 `packages/core/prompts/ingest/` 底下的
 * `cards.md` / `children.md` / `regenerate.md` 三個檔**都是用同一個 `'ingest.cards'`
 * 呼叫 router**(查證:`generate-cards.ts:77`、`children.ts:126`)。用任務名當 key 的話
 * 那三個檔只能登記一個,另外兩個沒有基準也沒有人會發現。所以 key 是 `GoldenSetId`,
 * `task` 欄位仍然只放契約 §7 的值——**契約一個字都沒改**。
 *
 * ## 輸入從哪裡來
 *
 * 資安切片從 `contracts/fixtures/raw/security-basics.md` 切(見 `raw-slices.ts`)。
 * 那是 I1 真跑用的來源,基準才對應真實使用。
 * T18 (d2) 的三個泛化輸入從 `fixtures/golden-generalization/` 切
 * (見 `generalization-slices.ts`):自擬的公開常識,不取自 `raw/`、`learning/`、帳本。
 *
 * ## prompt 怎麼組
 *
 * `GoldenInput.prompt` 只有會變動的那一半;`promptFile` 的內容由 `composeGoldenPrompt()`
 * 接在前面。header 區塊的格式照 02-ingest-pipeline 的四個 builder
 * (`buildBatchPrompt` / `buildChildrenPrompt` / `buildQuestionsPrompt` / `buildDepsPrompt`),
 * 多一行 `golden: <input id>` 讓 `--fake` 的 fixture 對得起來(FakeLlmRouter 靠
 * `prompt_contains` 比對,同一個 task 底下的標記必須唯一)。
 *
 * ## 05 的 grade.apply
 *
 * `grade.apply` 的 prompt 仍寫在程式裡,真實登記待 05。`packages/core/prompts/grading/`
 * 的 reteach-short.md 是 T65 的縮短版,不是 grade.apply。Wave 0 留下的那組 demo 改名成 `selftest`,
 * 它評的是 `golden-sets/` 自己的佔位 prompt 檔,不是真的任務,
 * 因此被 `REAL_TASK_GOLDEN_SET_IDS` 排除。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { Card } from '@contracts/index.js';
import { formatAlreadyCovered, listSiblings } from '@core/ingest/siblings.js';
import { GENERALIZATION_SLICES, generalizationSliceBody, type GeneralizationSlice } from './generalization-slices.js';
import { RAW_SLICES, sliceBody, sliceRaw, type RawSlice } from './raw-slices.js';
import type { GoldenInput, GoldenSet, GoldenSetId } from '../types.js';

const ROOT = resolve(import.meta.dirname, '../../../../..');

/** 真的 prompt 檔放這裡(相對 repo 根目錄)。守門測試掃的就是這個目錄。 */
export const PROMPTS_DIR = 'packages/core/prompts';

/** I1 那次 ingest 的分類與來源標示,跟 02 送出去的 header 一致。 */
const CATEGORY = 'security';
const SOURCE_LABEL = 'security-basics.md';

/** golden 用的卡片 id。前綴跟真的卡片 id(`sec-0001`)分開,免得被誤認成真資料。 */
function cardId(slice: RawSlice): string {
  return `sec-golden-${slice.key}`;
}

/** header 區塊 + 內容,格式同 02 的 builder(`---` 夾住 header,然後是內容)。 */
function block(header: string[], body: string): string {
  return ['---', ...header, '---', body].join('\n');
}

function cardsInput(slice: RawSlice): GoldenInput {
  const id = `cards-${slice.key}`;
  return {
    id,
    prompt: block([`golden: ${id}`, `category: ${CATEGORY}`, `source: ${SOURCE_LABEL}`], sliceRaw(slice)),
  };
}

/** T12 合併後的 children 基準(2026-10-16)複本。sha256 由紅測試釘死,這裡只讀。 */
const T18_CHILDREN_DIR = 'packages/core/src/prompt-quality/fixtures/golden-t18';
const L0_CARDS_DIR = 'packages/core/src/prompt-quality/golden/ingest.cards/2026-10-15';
const GEN_L0_DIR = 'packages/core/src/prompt-quality/fixtures/golden-generalization/ingest.cards';

/** 泛化輸入的分類。不要沿用資安的 `security`。 */
const GEN_CATEGORY = 'chemistry';

function readOutputCards(relFromRoot: string): { title: string; body: string }[] {
  const envelope = JSON.parse(readFileSync(join(ROOT, relFromRoot), 'utf8')) as { text?: unknown };
  const text = envelope.text;
  const parsed: unknown = typeof text === 'string' ? JSON.parse(text) : text;
  if (!Array.isArray(parsed)) return [];
  return parsed.map((item) => {
    const obj = item as { title?: unknown; body?: unknown };
    return {
      title: typeof obj.title === 'string' ? obj.title : '',
      body: typeof obj.body === 'string' ? obj.body : '',
    };
  });
}

/** listSiblings 要的是 Card。golden 的卡沒有真的 id,這裡自己配,不寫進 prompt。 */
function stubCard(id: string, category: string, title: string, body: string): Card {
  return {
    frontmatter: {
      id,
      category,
      title,
      level: 0,
      source: 'llm',
      created: '2026-10-16',
      parent: category === GEN_CATEGORY ? 'chm-0001' : 'sec-0001',
      prereqs: [],
      provisional: false,
      stale: false,
      source_missing: false,
    },
    body,
    examples: [],
  };
}

function toSiblingCards(raws: { title: string; body: string }[], category: string, prefix: string): Card[] {
  return raws.map((raw, i) => stubCard(`${prefix}-${String(i + 1).padStart(4, '0')}`, category, raw.title, raw.body));
}

/**
 * 工單 (d):另外兩個切片的 L0 + 排在前面的切片的子卡。
 * 行由 listSiblings 的輸出經 formatAlreadyCovered 組出,不另寫一份摘要。
 */
function securityCovered(slice: RawSlice): string[] {
  const order = RAW_SLICES.map((s) => s.key);
  const idx = order.indexOf(slice.key);
  const others = order.filter((k) => k !== slice.key);
  const before = order.slice(0, idx < 0 ? 0 : idx);
  const raws = [
    ...others.flatMap((k) => readOutputCards(`${L0_CARDS_DIR}/cards-${k}.output.json`)),
    ...before.flatMap((k) => readOutputCards(`${T18_CHILDREN_DIR}/children-${k}.output.json`)),
  ];
  const parent = stubCard('sec-9000', CATEGORY, slice.heading, '');
  return formatAlreadyCovered(listSiblings(toSiblingCards(raws, CATEGORY, 'sec'), parent));
}

/** 工單 (d2):另外兩個切片的手寫 L0。不含前面切片的子卡。 */
function generalizationCovered(slice: GeneralizationSlice): string[] {
  const raws = GENERALIZATION_SLICES.filter((s) => s.key !== slice.key).flatMap((s) =>
    readOutputCards(`${GEN_L0_DIR}/cards-gen-${s.key}.output.json`),
  );
  const parent = stubCard('chm-9000', GEN_CATEGORY, slice.heading, '');
  return formatAlreadyCovered(listSiblings(toSiblingCards(raws, GEN_CATEGORY, 'chm'), parent));
}

function childrenInput(slice: RawSlice): GoldenInput {
  const id = `children-${slice.key}`;
  return {
    id,
    prompt: block(
      [`golden: ${id}`, `parent_id: ${cardId(slice)}`, `parent_title: ${slice.heading}`, ...securityCovered(slice)],
      sliceBody(slice),
    ),
  };
}

function generalizationInput(slice: GeneralizationSlice): GoldenInput {
  const id = `children-gen-${slice.key}`;
  return {
    id,
    group: 'generalization',
    prompt: block(
      [`golden: ${id}`, `parent_id: chm-golden-${slice.key}`, `parent_title: ${slice.heading}`, ...generalizationCovered(slice)],
      generalizationSliceBody(slice),
    ),
  };
}

/**
 * regenerate 的輸入是「上一次太長的 body」。切片正文本身就超過 100 字上限
 * (`raw-slices.test.ts` 釘住這件事),所以不用另外編一段假的超長文字。
 * 沒有結尾的 `---`,跟 `buildRegeneratePrompt` 一致。
 */
function regenerateInput(slice: RawSlice): GoldenInput {
  const id = `regenerate-${slice.key}`;
  return {
    id,
    prompt: [
      '---',
      `golden: ${id}`,
      `category: ${CATEGORY}`,
      `source: ${SOURCE_LABEL}`,
      `title: ${slice.heading}`,
      'limit: 100',
      `previous body: ${sliceBody(slice).replace(/\n/g, ' ')}`,
    ].join('\n'),
  };
}

function questionsInput(slice: RawSlice): GoldenInput {
  const id = `questions-${slice.key}`;
  return {
    id,
    prompt: block([`golden: ${id}`, `card: ${cardId(slice)}`, `title: ${slice.heading}`], sliceBody(slice)),
  };
}

/** deps 的輸入是「一批卡的 id 與 title 清單」,不是文章,所以形狀跟其他四組不同。 */
function depsInput(id: string, slices: readonly RawSlice[]): GoldenInput {
  return {
    id,
    prompt: [
      '---',
      `golden: ${id}`,
      `category: ${CATEGORY}`,
      '',
      'cards:',
      ...slices.map((s) => `- ${cardId(s)}: ${s.heading}`),
    ].join('\n'),
  };
}

const [SAME_ORIGIN, CORS, PREFLIGHT] = RAW_SLICES as unknown as [RawSlice, RawSlice, RawSlice];

const INGEST_CARDS: GoldenSet = {
  id: 'ingest.cards',
  task: 'ingest.cards',
  promptFile: `${PROMPTS_DIR}/ingest/cards.md`,
  inputs: RAW_SLICES.map(cardsInput),
};

/**
 * T55:從主題生成。輸入是測試 agent 寫的一行主題(fixtures/golden-topic/topics.json),
 * 不取自 raw/。header 自己組,不 import ingest/。
 */
interface TopicFixture {
  key: string;
  category: string;
  topic: string;
}

function loadTopicFixtures(): TopicFixture[] {
  const path = join(ROOT, 'packages/core/src/prompt-quality/fixtures/golden-topic/topics.json');
  return JSON.parse(readFileSync(path, 'utf8')) as TopicFixture[];
}

function topicInput(item: TopicFixture): GoldenInput {
  const id = `topic-${item.key}`;
  return {
    id,
    prompt: block([`golden: ${id}`, `category: ${item.category}`, `topic: ${item.topic}`], item.topic),
  };
}

const INGEST_TOPIC: GoldenSet = {
  id: 'ingest.topic',
  // 契約 §7 沒有新任務。主題生成跟拆卡一樣走 ingest.cards,模板是 topic.md。
  task: 'ingest.cards',
  promptFile: `${PROMPTS_DIR}/ingest/topic.md`,
  inputs: loadTopicFixtures().map(topicInput),
};

const INGEST_CHILDREN: GoldenSet = {
  id: 'ingest.children',
  // generateChildren 用的是 'ingest.cards'——契約 §7 沒有 ingest.children 這個任務。
  task: 'ingest.cards',
  promptFile: `${PROMPTS_DIR}/ingest/children.md`,
  inputs: [...RAW_SLICES.map(childrenInput), ...GENERALIZATION_SLICES.map(generalizationInput)],
};

const INGEST_REGENERATE: GoldenSet = {
  id: 'ingest.regenerate',
  // generate-cards.ts 的 regenerate 走的也是 'ingest.cards'。
  task: 'ingest.cards',
  promptFile: `${PROMPTS_DIR}/ingest/regenerate.md`,
  inputs: RAW_SLICES.map(regenerateInput),
};

const INGEST_QUESTIONS: GoldenSet = {
  id: 'ingest.questions',
  task: 'ingest.questions',
  promptFile: `${PROMPTS_DIR}/ingest/questions.md`,
  inputs: RAW_SLICES.map(questionsInput),
};

/**
 * deps 的三個輸入不是三個切片,而是三份「卡片清單」——這個任務吃的就是清單。
 * 三份的差別是刻意的:
 *   1. 三張全給,看它連不連得出教學順序
 *   2. 只給兩張,看它會不會為了湊數硬連(prompt 寫「寧可少連也不要瞎猜」)
 *   3. 三張倒過來列,看邊的方向是從語意來的、還是從清單順序抄的
 * 三份的 id 與 title 全部來自 raw fixture 的三個 `##` 小節,沒有新編的卡。
 */
const INGEST_DEPS: GoldenSet = {
  id: 'ingest.deps',
  task: 'ingest.deps',
  promptFile: `${PROMPTS_DIR}/ingest/deps.md`,
  inputs: [
    depsInput('deps-three-sections', [SAME_ORIGIN, CORS, PREFLIGHT]),
    depsInput('deps-pair-origin-cors', [SAME_ORIGIN, CORS]),
    depsInput('deps-reversed-order', [PREFLIGHT, CORS, SAME_ORIGIN]),
  ],
};

/**
 * T65:縮短版。輸入是測試 agent 寫的三張公開常識卡(fixtures/golden-short/inputs.json),
 * 不取自 raw/。header 自己組,不 import ingest/。
 * 四行:golden / category / title / limit: 50,後接原卡 body 與每一個 example。
 */
interface ShortCardFixture {
  key: string;
  category: string;
  title: string;
  body: string;
  examples: string[];
}

function loadShortFixtures(): ShortCardFixture[] {
  const path = join(ROOT, 'packages/core/src/prompt-quality/fixtures/golden-short/inputs.json');
  return JSON.parse(readFileSync(path, 'utf8')) as ShortCardFixture[];
}

function shortInput(item: ShortCardFixture): GoldenInput {
  const id = `short-${item.key}`;
  const body = [item.body, ...item.examples].join('\n\n');
  return {
    id,
    prompt: block([`golden: ${id}`, `category: ${item.category}`, `title: ${item.title}`, 'limit: 50'], body),
  };
}

const RETEACH_SHORT: GoldenSet = {
  id: 'reteach.short',
  task: 'reteach.short',
  promptFile: `${PROMPTS_DIR}/grading/reteach-short.md`,
  inputs: loadShortFixtures().map(shortInput),
};

/**
 * Wave 0 留下的自我測試組(原名 `grade.apply`)。它評的是 `golden-sets/` 自己的佔位
 * prompt 檔,示範框架本身跑得起來;**05 尚未提供 prompt 檔,`grade.apply` 的真實登記待 05**。
 */
const SELFTEST: GoldenSet = {
  id: 'selftest',
  task: 'grade.apply',
  promptFile: 'packages/core/src/prompt-quality/golden-sets/grade.apply.selftest-prompt.md',
  inputs: [
    { id: 'demo-1', prompt: '[PQ_DEMO_1] 學生答案:CORS 是瀏覽器的同源保護機制。' },
    { id: 'demo-2', prompt: '[PQ_DEMO_2] 學生答案:同源政策跟 cookie 有關。' },
    { id: 'demo-3', prompt: '[PQ_DEMO_3] 學生答案:我不確定,大概跟安全性有關。' },
  ],
};

const REGISTRY: Partial<Record<GoldenSetId, GoldenSet>> = {
  'ingest.cards': INGEST_CARDS,
  'ingest.topic': INGEST_TOPIC,
  'ingest.children': INGEST_CHILDREN,
  'ingest.regenerate': INGEST_REGENERATE,
  'ingest.questions': INGEST_QUESTIONS,
  'ingest.deps': INGEST_DEPS,
  'reteach.short': RETEACH_SHORT,
  selftest: SELFTEST,
};

/** 真的任務(對到 `packages/core/prompts/` 底下的檔)。`selftest` 不算。 */
export const REAL_TASK_GOLDEN_SET_IDS: readonly GoldenSetId[] = [
  'ingest.cards',
  'ingest.topic',
  'ingest.children',
  'ingest.regenerate',
  'ingest.questions',
  'ingest.deps',
  'reteach.short',
];

export const GOLDEN_SET_REGISTRY_FILE = 'packages/core/src/prompt-quality/golden-sets/registry.ts';

export function getGoldenSet(set: GoldenSetId): GoldenSet | undefined {
  return REGISTRY[set];
}

export function listGoldenSets(): GoldenSetId[] {
  return Object.keys(REGISTRY) as GoldenSetId[];
}

/** 登記表裡所有 golden set,順序照 `listGoldenSets()`。 */
export function allGoldenSets(): GoldenSet[] {
  return listGoldenSets().map((id) => REGISTRY[id]!);
}

// --------------------------------- 守門:每個 prompt 檔恰好被一組 golden set 引用

/**
 * 掃 `packages/core/prompts/` 底下所有 `.md`,回傳 repo 相對路徑(以 `/` 分隔、已排序)。
 *
 * **掃到 0 個檔要當成壞掉**(P-28:空的掃描器跟全綠一樣),判斷交給呼叫端——
 * `checkPromptCoverage()` 與 `--list` 都會紅。
 */
export function scanPromptFiles(promptsDir = PROMPTS_DIR): string[] {
  // resolve 而不是 join:promptsDir 給絕對路徑時要當成絕對路徑,不是接在 ROOT 後面。
  // 差別看得到——join 會把不存在的 ROOT/tmp/xxx 當成「掃到 0 個」,
  // 於是「空目錄」的測試其實在測「目錄不存在」,兩件事被混成一件。
  const abs = resolve(ROOT, promptsDir);
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.md')) out.push(relative(ROOT, p).split(sep).join('/'));
    }
  };
  if (statSync(abs, { throwIfNoEntry: false })?.isDirectory()) walk(abs);
  return out.sort();
}

/** 同一個 prompt 檔被兩組以上的 golden set 引用。 */
export interface DuplicateReference {
  promptFile: string;
  /** 指到它的 golden set id,已排序 */
  sets: GoldenSetId[];
}

export interface PromptCoverage {
  /** 掃到的 prompt 檔(repo 相對路徑,已排序) */
  scanned: string[];
  /** 掃到、但沒有任何 golden set 的 promptFile 指到它 */
  unregistered: string[];
  /** 有 golden set 指過去、但檔案不在掃描結果裡(路徑打錯或檔案被刪) */
  missing: string[];
  /**
   * 被兩組以上的 golden set 指到的 prompt 檔。
   *
   * 守門要的是「**恰好**一組」,不是「至少一組」:只查 unregistered 的話,
   * 把 A 的 promptFile 複製貼到 B 身上、同時 A 換成別的檔,兩邊都還「有人引用」,
   * 掃描器全綠——可是 B 的基準其實在評 A 的 prompt,改了 B 的 prompt 檔沒有人在看。
   * 引用數 0 是沒守著,引用數 2 是守錯了東西,兩種都要紅。
   */
  duplicated: DuplicateReference[];
  /** 掃到 0 個檔——掃描器壞了,不是「很乾淨」 */
  scannerBroken: boolean;
}

/**
 * 「框架有沒有接上真的東西」的守門。沒被任何 golden set 引用的 prompt 檔就是紅的:
 * 改了它、跑 `--diff` 會拿到「沒有變化」,因為根本沒在比那個 prompt。
 *
 * 兩個參數都有預設值,平常不用給;測試靠它們餵「登記表指到不存在的檔」這種
 * 在真的 repo 裡造不出來(也不該造)的狀態。
 */
export function checkPromptCoverage(promptsDir = PROMPTS_DIR, sets = allGoldenSets()): PromptCoverage {
  const scanned = scanPromptFiles(promptsDir);
  const referenced = new Set(sets.map((s) => s.promptFile));
  const scannedSet = new Set(scanned);

  // 一個 prompt 檔 → 指到它的所有 set。長度 > 1 就是「守錯了東西」。
  // 先把檔名排好再組結果,不要用 comparator:Map 的 key 不會重複,
  // 所以 `a < b` 跟 `a <= b` 在這裡永遠一樣——那種變異殺不掉,程式也不該長那樣。
  const bySet = new Map<string, GoldenSetId[]>();
  for (const s of sets) bySet.set(s.promptFile, [...(bySet.get(s.promptFile) ?? []), s.id]);
  const duplicated: DuplicateReference[] = [...bySet.keys()]
    .filter((f) => (bySet.get(f) ?? []).length > 1)
    .sort()
    .map((promptFile) => ({ promptFile, sets: [...bySet.get(promptFile)!].sort() }));

  return {
    scanned,
    unregistered: scanned.filter((f) => !referenced.has(f)),
    missing: [...referenced].filter((f) => f.startsWith(`${promptsDir}/`) && !scannedSet.has(f)).sort(),
    duplicated,
    scannerBroken: scanned.length === 0,
  };
}
