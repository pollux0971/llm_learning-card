/**
 * I2 整合的步驟定義(docs/integration/i2-review-loop-headless.feature)。
 *
 * 前半(Background 與兩個 @regression 場景)是 P-28 那一輪寫的:這兩個場景刻意 spawn 真的
 * `scripts/review.ts`(走 `this.runCommand`),因為要守的東西就是**使用者在終端機看到的字與退出碼**。
 *
 * 後半(「I2 整合工作」,T13)是其餘 12 個場景。原則:
 *   - 凡是「使用者在終端機看到/留下什麼」的斷言,一律 spawn 真的 `scripts/review.ts` / `scripts/ingest.ts`;
 *     只有「session 怎麼排」這類純建構的斷言才在程序內直接 build。
 *   - 沒有任何一步花錢或打網路。子程序的網路層由 `_fake-review-cloud.mjs` 換成假的(照 `_fake-cloud.mjs`
 *     的模式:CloudLlmRouter / openaiAdapter / OpenAI SDK 全跑真的,只換最外層 fetch);
 *     程序內的呼叫則注入一個假的 CloudAdapter(`scriptedCloudAdapter`)。回應腳本在 `_i2-cloud-script.ts`,
 *     兩邊共用,以「作答文字裡的標記」決定回應。
 *   - 子程序的帳本走真的 `resolveVerifiedLedger`:每個場景在暫存目錄寫一份指標檔與身分標記
 *     (XDG_CONFIG_HOME 指到暫存目錄),所以「CLI 用帳本驗證過的路徑組 router」是被走過的路,不是被繞過的。
 *   - 這份檔案**不 import FakeLlmRouter**:I2 的重點就是迴路裡沒有 fake。
 */
import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { CardId, Review } from '@contracts/index.js';
import { gradeFillQuestion, type LlmResult } from '@core/grading/index.js';
import { CloudLlmRouter } from '@core/llm/index.js';
import type { CloudAdapter, LlmRouter } from '@core/llm/index.js';
import { addIsoDays } from '@core/scheduler/dates.js';
import { countWords } from '@core/schema/word-count.js';
import { buildTodaySession } from '../../packages/core/src/session/build.js';
import { submitAnswer } from '../../packages/core/src/session/answer.js';
import { presentNextCard } from '../../packages/core/src/session/present.js';
import type { Session } from '../../packages/core/src/session/types.js';
import { scriptedApplyReply } from './_i2-cloud-script.js';
import type { LearningWorld, RunResult } from './_world.js';

/** 使用者每天看到的那句話。0 張卡的時候絕不可以出現。 */
const NOTHING_DUE = 'Nothing is due today.';

function dirOf(world: LearningWorld): string {
  assert.ok(world.dir, 'Background 應該先建立 learning 目錄(useFixture)');
  return world.dir;
}

/** 直接數磁碟上的卡片檔,拿來跟 CLI 印出來的數字對照——不共用 CLI 自己的計算。 */
function countCardsOnDisk(dir: string): number {
  const cardsDir = join(dir, 'cards');
  let total = 0;
  for (const category of readdirSync(cardsDir)) {
    if (!statSync(join(cardsDir, category)).isDirectory()) continue;
    total += readdirSync(join(cardsDir, category)).filter((n) => n.endsWith('.md') && !n.endsWith('.short.md')).length;
  }
  return total;
}

function outputOf(world: LearningWorld): string {
  assert.ok(world.lastRun, '還沒有跑過任何指令(When 要呼叫 runCommand)');
  return world.lastRun.output;
}

// ---------------------------------------------------------------- Given

Given('the settings have daily_cap {int}', function (this: LearningWorld, cap: number) {
  const path = join(dirOf(this), 'config/settings.yaml');
  const text = readFileSync(path, 'utf8');
  assert.match(text, /^daily_cap:/m, `settings.yaml 沒有 daily_cap 欄位:\n${text}`);
  writeFileSync(path, text.replace(/^daily_cap:.*$/m, `daily_cap: ${cap}`), 'utf8');
});

Given('the vault has no cards at all', function (this: LearningWorld) {
  // cards/ 整個消失——目錄被搬走 / 路徑改了 / 同步刪掉之後真正會看到的樣子。
  rmSync(join(dirOf(this), 'cards'), { recursive: true, force: true });
});

Given('the vault has cards and none of them fall due today', function (this: LearningWorld) {
  const dir = dirOf(this);
  assert.ok(countCardsOnDisk(dir) > 0, '這個場景需要 vault 裡真的有卡片');

  // 每張卡都排好了,只是都排在很久以後——這才是「正常的安靜日」,
  // 跟「卡片全部不見」必須長得不一樣。
  const reviews: Record<string, unknown> = {};
  const cardsDir = join(dir, 'cards');
  for (const category of readdirSync(cardsDir)) {
    for (const name of readdirSync(join(cardsDir, category))) {
      if (!name.endsWith('.md') || name.endsWith('.short.md')) continue;
      reviews[name.slice(0, -'.md'.length)] = {
        stage: 2,
        learned_at: '2026-08-01',
        next_due: '2026-12-01',
        fails_in_row: 0,
        total_fails: 0,
        stuck: false,
        history: [],
      };
    }
  }
  writeFileSync(join(dir, 'state/reviews.json'), `${JSON.stringify(reviews, null, 2)}\n`, 'utf8');
});

// ---------------------------------------------------------------- When

When('the person asks what is due today', function (this: LearningWorld) {
  this.runCommand(`npx tsx scripts/review.ts --dir ${dirOf(this)} --today ${this.today} --dry-run`);
});

// ---------------------------------------------------------------- Then

Then('the command says the vault has no cards', function (this: LearningWorld) {
  const output = outputOf(this);
  assert.match(output, /沒有卡片|一張卡片也沒有/, `應該明講這個 vault 沒有卡片:\n${output}`);
  assert.match(output, /(^|\D)0\s*張卡/, `應該把 0 這個數字印出來:\n${output}`);
});

Then('it does not say that nothing is due today', function (this: LearningWorld) {
  const output = outputOf(this);
  assert.ok(!output.includes(NOTHING_DUE), `0 張卡的時候不可以印「${NOTHING_DUE}」:\n${output}`);
});

Then('the command reports how many cards it looked at', function (this: LearningWorld) {
  const output = outputOf(this);
  const m = /(\d+)\s*張卡/.exec(output);
  assert.ok(m, `輸出裡沒有「N 張卡」:\n${output}`);
  assert.equal(
    Number(m[1]),
    countCardsOnDisk(dirOf(this)),
    `印出來的張數跟磁碟上的卡片數不一致:\n${output}`,
  );
});

Then('it says nothing is due today', function (this: LearningWorld) {
  const output = outputOf(this);
  assert.ok(output.includes(NOTHING_DUE), `安靜的一天仍然要說「${NOTHING_DUE}」:\n${output}`);
});

// =====================================================================================
// T13:其餘 12 個場景。下面全部是這一輪新加的。
// =====================================================================================

const ROOT = resolve(import.meta.dirname, '../..');
const TEMPLATE_CARD = 'sec-0001';

type Answer = 'correct' | 'incorrect' | 'garbage' | 'long' | 'empty';

interface I2State {
  /** 這個場景屬於 I2 整合 feature(Before 設定) */
  active: boolean;
  /** 隨場景建立、場景結束刪掉的暫存目錄(指標檔、請求紀錄) */
  scratch?: string;
  vaultReady: boolean;
  /** 依 queue 順序,每張卡一筆 */
  script: Answer[];
  /** 作答用完之後怎麼辦:'empty' = 其餘一律空白作答;'eof' = 關掉 stdin(模擬使用者中途離開) */
  onExhausted: 'empty' | 'eof';
  runs: RunResult[];
  /** 每次 CLI 執行時,磁碟上 reviews.json 的快照(執行前) */
  reviewsBefore?: Record<CardId, Review> | undefined;
  session?: Session;
  /** S4 */
  fill?: { prompt: string; answers: string[][] };
  fillResult?: { pass: boolean | null; grader: string };
  adapterCalls: string[];
  /** S5/S6/S10 */
  applyCard?: CardId;
  /** S11 */
  presentedPerRun: CardId[][];
  seededCards: CardId[];
  /** S12 */
  ingestOut?: string;
  ingestRun?: RunResult;
}

const states = new WeakMap<LearningWorld, I2State>();
function st(world: LearningWorld): I2State {
  let s = states.get(world);
  if (!s) {
    s = { active: false, vaultReady: false, script: [], onExhausted: 'empty', runs: [], adapterCalls: [], presentedPerRun: [], seededCards: [] };
    states.set(world, s);
  }
  return s;
}

// ---------------------------------------------------------------- 場景外圍:哪個 feature、暫存目錄

/**
 * `@i2` 這個 tag 掛在 8 個 feature 上(04/05/11/12 的 phase 檔也有),不能用它判斷「現在跑的是 I2 整合」。
 * 其他步驟檔(scheduler / data-layer / grading / review-cli)要把共用的句子分派過來時,問這個函式。
 */
export function isI2Loop(world: LearningWorld): boolean {
  return states.get(world)?.active === true;
}

Before(function (this: LearningWorld, { pickle }) {
  if (pickle.uri.endsWith('docs/integration/i2-review-loop-headless.feature')) st(this).active = true;
});

After(function (this: LearningWorld) {
  const s = states.get(this);
  if (!s?.active) return;
  if (s.scratch) rmSync(s.scratch, { recursive: true, force: true });
  if (s.ingestOut) rmSync(s.ingestOut, { recursive: true, force: true });
});

function scratchOf(world: LearningWorld): string {
  const s = st(world);
  s.scratch ??= mkdtempSync(join(tmpdir(), 'lc-i2-'));
  return s.scratch;
}

// ---------------------------------------------------------------- 磁碟狀態

function reviewsFile(world: LearningWorld): string {
  return join(dirOf(world), 'state/reviews.json');
}
function readReviews(world: LearningWorld): Record<CardId, Review> {
  return JSON.parse(readFileSync(reviewsFile(world), 'utf8')) as Record<CardId, Review>;
}
function writeReviews(world: LearningWorld, reviews: Record<CardId, Review>): void {
  writeFileSync(reviewsFile(world), `${JSON.stringify(reviews, null, 2)}\n`, 'utf8');
}
function review(overrides: Partial<Review> & Pick<Review, 'stage' | 'learned_at' | 'next_due'>): Review {
  return { fails_in_row: 0, total_fails: 0, stuck: false, history: [], ...overrides };
}
function cardIdOf(n: number): CardId {
  return `sec-${String(n).padStart(4, '0')}`;
}

/** 磁碟上有哪些卡(id)。 */
function cardsOnDisk(world: LearningWorld): CardId[] {
  const out: CardId[] = [];
  const cardsDir = join(dirOf(world), 'cards');
  for (const category of readdirSync(cardsDir)) {
    const dir = join(cardsDir, category);
    if (!statSync(dir).isDirectory()) continue;
    for (const name of readdirSync(dir)) if (name.endsWith('.md') && !name.endsWith('.short.md')) out.push(name.slice(0, -3));
  }
  return out.sort();
}

/**
 * 讓磁碟上有 n 張可以考的卡(sec-0001..sec-000n)。前 3 張是 fixture 原本就有的;
 * 第 4 張起複製 sec-0001 的卡片與考題,填空題幹加上卡片 id,所以從「作答時印出的題幹」就認得出是哪一張。
 */
function ensureCards(world: LearningWorld, n: number): CardId[] {
  const dir = dirOf(world);
  const ids: CardId[] = [];
  for (let i = 1; i <= n; i += 1) {
    const id = cardIdOf(i);
    ids.push(id);
    if (existsSync(join(dir, 'questions', `${id}.yaml`))) continue;
    const card = readFileSync(join(dir, 'cards/security', `${TEMPLATE_CARD}.md`), 'utf8').replace(`id: ${TEMPLATE_CARD}`, `id: ${id}`);
    writeFileSync(join(dir, 'cards/security', `${id}.md`), card, 'utf8');
    const q = parseYaml(readFileSync(join(dir, 'questions', `${TEMPLATE_CARD}.yaml`), 'utf8')) as {
      card: string;
      fill: { prompt: string; answers: string[][] }[];
      apply: { prompt: string; rubric: string[] }[];
    };
    q.card = id;
    for (const f of q.fill) f.prompt = `[${id}] ${f.prompt}`;
    for (const a of q.apply) a.prompt = `[${id}] ${a.prompt}`;
    writeFileSync(join(dir, 'questions', `${id}.yaml`), JSON.stringify(q, null, 2), 'utf8');
  }
  return ids;
}

/** 「N cards are due today」在 @i2 的實作(scheduler.steps.ts 依 tag 分派過來)。 */
export function seedI2CardsDue(world: LearningWorld, n: number): void {
  const ids = ensureCards(world, n);
  const reviews: Record<CardId, Review> = {};
  for (const id of ids) reviews[id] = review({ stage: 1, learned_at: '2026-09-09', next_due: world.today });
  writeReviews(world, reviews);
  st(world).seededCards = ids;
}

/** sec-0001 排在今天、指定 stage;rubric 條數可指定(S5 的「3 條」)。 */
function seedApplyCard(world: LearningWorld, stage: 1 | 2 | 3 | 4 | 5, rubricCount?: number): CardId {
  const id = cardIdOf(1);
  writeReviews(world, { [id]: review({ stage, learned_at: addIsoDays(world.today, -30), next_due: world.today }) });
  if (rubricCount !== undefined) {
    const path = join(dirOf(world), 'questions', `${id}.yaml`);
    const q = parseYaml(readFileSync(path, 'utf8')) as { apply: { prompt: string; rubric: string[] }[] };
    q.apply[0]!.rubric = Array.from({ length: rubricCount }, (_, i) => `rubric item ${i + 1}`);
    writeFileSync(path, JSON.stringify(q, null, 2), 'utf8');
  }
  st(world).applyCard = id;
  return id;
}

/** 題幹 → 卡片 id(從磁碟上的考題檔建立,不靠 CLI 印出卡片 id)。 */
function promptIndex(world: LearningWorld): Map<string, CardId> {
  const map = new Map<string, CardId>();
  for (const id of cardsOnDisk(world)) {
    const q = parseYaml(readFileSync(join(dirOf(world), 'questions', `${id}.yaml`), 'utf8')) as {
      fill: { prompt: string }[];
      apply: { prompt: string }[];
    };
    map.set(q.fill[0]!.prompt, id);
    map.set(q.apply[0]!.prompt, id);
  }
  return map;
}

// ---------------------------------------------------------------- 假雲端(程序內)與 session 建構

/** 假的 CloudAdapter:照 `_i2-cloud-script.ts` 回應,並記下每一次呼叫。 */
function scriptedCloudAdapter(world: LearningWorld): CloudAdapter {
  return {
    async call({ prompt, model }) {
      st(world).adapterCalls.push(prompt);
      return { text: scriptedApplyReply(prompt), provider: 'openai', model, latency_ms: 0, tokens_in: 1, tokens_out: 1 };
    },
  };
}

/** 注入假 adapter 的真 CloudLlmRouter,帳本寫進這個場景的 learning/state/log.jsonl。 */
function injectedRouter(world: LearningWorld): LlmRouter {
  return new CloudLlmRouter({
    env: { LLM_CLOUD_PROVIDER: 'openai', LLM_CLOUD_MODEL: 'fake-model', OPENAI_API_KEY: 'fake-key' },
    adapters: { openai: scriptedCloudAdapter(world) },
    logPath: join(dirOf(world), 'state/log.jsonl'),
  });
}

/** 只用來「建 session、看排序」的 router:被呼叫就是這個場景走錯了路。 */
const NEVER_CALLED_ROUTER: LlmRouter = {
  async call() {
    throw new Error('這個 router 只用來建 session 看排序,不應該被呼叫');
  },
  async probeOnline() {
    return false;
  },
  async probeLocal() {
    return { available: false, models: [] };
  },
};

async function buildSessionFor(world: LearningWorld, today = world.today): Promise<Session> {
  return buildTodaySession({ learningDir: dirOf(world), today, router: NEVER_CALLED_ROUTER });
}

// ---------------------------------------------------------------- 子程序:真的 scripts/review.ts

function setupVault(world: LearningWorld): string {
  const s = st(world);
  const xdg = join(scratchOf(world), 'xdg');
  if (!s.vaultReady) {
    const vaultId = randomUUID();
    mkdirSync(join(xdg, 'llm-learning-cards'), { recursive: true });
    writeFileSync(join(xdg, 'llm-learning-cards', 'vault.json'), JSON.stringify({ learning_dir: dirOf(world), vault_id: vaultId }), 'utf8');
    mkdirSync(join(dirOf(world), 'config'), { recursive: true });
    writeFileSync(join(dirOf(world), 'config/vault-id'), `${vaultId}\n`, 'utf8');
    s.vaultReady = true;
  }
  return xdg;
}

function requestLogPath(world: LearningWorld): string {
  return join(scratchOf(world), 'cloud-requests.jsonl');
}

/** 子程序送出的雲端請求(假網路層記的)。 */
function cloudRequests(world: LearningWorld): string[] {
  const path = requestLogPath(world);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => (JSON.parse(l) as { prompt: string }).prompt);
}

function ledgerEvents(world: LearningWorld): Record<string, unknown>[] {
  const path = join(dirOf(world), 'state/log.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function childEnv(world: LearningWorld): NodeJS.ProcessEnv {
  const { NODE_OPTIONS: _drop, ...rest } = process.env;
  return {
    ...rest,
    XDG_CONFIG_HOME: setupVault(world),
    LLM_CLOUD_PROVIDER: 'openai',
    LLM_CLOUD_MODEL: 'fake-model',
    OPENAI_API_KEY: 'fake-key',
    ANTHROPIC_API_KEY: 'fake-key',
    FAKE_REVIEW_REQUEST_LOG: requestLogPath(world),
  };
}

const REVIEW_CMD = ['tsx', '--import', './features/steps/_fake-review-cloud.mjs', 'scripts/review.ts'];
const FILL_PROMPT_MARK = '用逗號分隔:';
const APPLY_PROMPT_MARK = '輸入空行結束:';

/** 一題要送出的幾行(填空 1 行;應用題 1 行加結尾空行)。 */
interface AnswerLines {
  lines: string[];
}

function fillLinesFor(world: LearningWorld, card: CardId, answer: Answer): string {
  const q = parseYaml(readFileSync(join(dirOf(world), 'questions', `${card}.yaml`), 'utf8')) as {
    fill: { prompt: string; answers: string[][] }[];
  };
  const fill = q.fill[0]!;
  if (answer === 'correct') return fill.answers.map((group) => group[0]!).join(',');
  if (answer === 'empty') return '';
  return fill.answers.map(() => 'wrong').join(',');
}

function applyTextFor(answer: Answer): string {
  switch (answer) {
    case 'correct':
      return 'PASSALL';
    case 'incorrect':
      return 'FAILONE';
    case 'garbage':
      return 'GARBAGE';
    case 'long':
      return 'LONGFEEDBACK';
    case 'empty':
      return '';
  }
}

/** 依 queue 順序與腳本,算出每一題要送的行。 */
async function answerPlan(world: LearningWorld): Promise<AnswerLines[]> {
  const s = st(world);
  const session = await buildSessionFor(world);
  const plan: AnswerLines[] = [];
  session.queue.forEach((item, i) => {
    const answer = s.script[i] ?? (s.onExhausted === 'eof' ? undefined : 'empty');
    for (const type of item.types) {
      if (answer === undefined) return;
      if (type === 'fill') plan.push({ lines: [fillLinesFor(world, item.card, answer)] });
      else plan.push({ lines: applyTextFor(answer) === '' ? [''] : [applyTextFor(answer), ''] });
    }
  });
  return plan;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 跑一次互動式的 review.ts。stdin 不能一次全灌進去:readline 在兩題之間(await 磁碟寫入的空檔)
 * 收到的行會被丟掉,所以看到提示字才送下一題;應用題的兩行之間也要隔一小段時間。
 */
async function runInteractiveReview(world: LearningWorld, plan: AnswerLines[], eofWhenExhausted: boolean): Promise<RunResult> {
  const child = spawn('npx', [...REVIEW_CMD, '--dir', dirOf(world), '--today', world.today], {
    cwd: ROOT,
    env: childEnv(world),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let asked = 0;
  let answered = 0;
  let writing = Promise.resolve();
  const countPrompts = (): number => stdout.split(FILL_PROMPT_MARK).length - 1 + (stdout.split(APPLY_PROMPT_MARK).length - 1);

  const feed = (): void => {
    while (answered < countPrompts()) {
      const group = plan[answered];
      answered += 1;
      if (group === undefined) {
        if (eofWhenExhausted) {
          writing = writing.then(() => {
            child.stdin.end();
          });
          return;
        }
        writing = writing.then(() => {
          child.stdin.write('\n');
        });
        continue;
      }
      writing = writing.then(async () => {
        for (const line of group.lines) {
          child.stdin.write(`${line}\n`);
          await sleep(150);
        }
      });
    }
    asked = countPrompts();
  };

  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
    feed();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });

  const status = await new Promise<number | null>((resolveStatus) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolveStatus(null);
    }, 120_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveStatus(code);
    });
    child.stdin.on('error', () => {
      /* 子程序先結束了,寫入失敗不是這裡要報的 */
    });
  });
  void asked;
  const result: RunResult = { status, stdout, stderr, output: stdout + stderr };
  world.lastRun = result;
  st(world).runs.push(result);
  return result;
}

/** 非互動:--dry-run。 */
function runDryRun(world: LearningWorld, today = world.today): RunResult {
  const r = spawnSync('npx', [...REVIEW_CMD, '--dir', dirOf(world), '--today', today, '--dry-run'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
    env: childEnv(world),
  });
  const result: RunResult = { status: r.error ? null : r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  world.lastRun = result;
  return result;
}

/** 這個場景的互動式 session 還沒跑就跑;跑過了回傳上一次的結果。 */
async function ensureRun(world: LearningWorld): Promise<RunResult> {
  const s = st(world);
  if (s.runs.length > 0) return s.runs[s.runs.length - 1]!;
  return runFreshSession(world);
}

async function runFreshSession(world: LearningWorld): Promise<RunResult> {
  const s = st(world);
  s.reviewsBefore = existsSync(reviewsFile(world)) ? readReviews(world) : {};
  const plan = await answerPlan(world);
  const run = await runInteractiveReview(world, plan, s.onExhausted === 'eof');
  s.presentedPerRun.push(presentedCards(world, run.stdout));
  return run;
}

/** 從輸出的題幹認出這一輪問了哪些卡(依出現順序,同一張卡的兩題只算一次)。 */
function presentedCards(world: LearningWorld, output: string): CardId[] {
  const index = promptIndex(world);
  const seen: CardId[] = [];
  for (const line of output.split('\n')) {
    const m = /^\(\d+\/\d+\) (.*?)(?:\s{2}\(這張卡.*)?$/.exec(line);
    if (!m) continue;
    const card = index.get(m[1]!);
    if (card && !seen.includes(card)) seen.push(card);
  }
  return seen;
}

function questionLines(output: string): string[] {
  return output.split('\n').filter((l) => /^\(\d+\/\d+\) /.test(l));
}

// ---------------------------------------------------------------- S1:一整輪複習

When('the person runs the review command', function (this: LearningWorld) {
  // 不在這裡跑:後面的 And 步驟才說這輪要怎麼作答,等第一個 Then 才一次跑完(ensureRun)。
  st(this).runs = [];
});

When(/^answers the (first|second|third) card (correctly|incorrectly)$/, function (this: LearningWorld, nth: string, how: string) {
  const index = ['first', 'second', 'third'].indexOf(nth);
  const s = st(this);
  s.script[index] = how === 'correctly' ? 'correct' : 'incorrect';
});

Then('the first two cards have advanced one stage', async function (this: LearningWorld) {
  const run = await ensureRun(this);
  const session = await buildSessionFor(this, this.today); // 作答後:今天已沒有到期的卡,不用它排序
  void session;
  const ids = st(this).seededCards.length > 0 ? st(this).seededCards : cardsOnDisk(this).slice(0, 3);
  const after = readReviews(this);
  const order = st(this).presentedPerRun[0] ?? [];
  assert.equal(order.length, 3, `應該問了 3 張卡,實際 ${order.length} 張:\n${run.output}`);
  for (const card of order.slice(0, 2)) {
    assert.equal(after[card]!.stage, 2, `${card} 應該從 stage 1 進到 stage 2:${JSON.stringify(after[card])}`);
    assert.equal(after[card]!.history.at(-1)?.pass, true);
  }
  void ids;
});

Then('the third card is back at stage 1 and due tomorrow', async function (this: LearningWorld) {
  await ensureRun(this);
  const third = st(this).presentedPerRun[0]![2]!;
  const after = readReviews(this)[third]!;
  assert.equal(after.stage, 1);
  assert.equal(after.next_due, addIsoDays(this.today, 1));
  assert.equal(after.history.at(-1)?.pass, false);
});

Then('{string} reflects all three outcomes', async function (this: LearningWorld, file: string) {
  assert.equal(file, 'state/reviews.json');
  await ensureRun(this);
  const after = readReviews(this);
  const outcomes = st(this).presentedPerRun[0]!.map((card) => after[card]!.history.map((h) => h.pass));
  assert.deepEqual(outcomes, [[true], [true], [false]], `三張卡的紀錄應該各一筆:通過、通過、答錯:${JSON.stringify(after)}`);
});

Then('the session prints a summary of {int} passed and {int} returned', async function (this: LearningWorld, passed: number, returned: number) {
  const run = await ensureRun(this);
  assert.ok(run.output.includes(`${passed} passed, ${returned} returned.`), `小結不對:\n${run.output}`);
  // 沒有卡被延後的時候不該印「延後」(有延後的場景才有那一行,見 daily cap 場景)
  assert.ok(!/張延後/.test(run.output), `沒有卡被延後,不該印延後那一行:\n${run.output}`);
  assert.equal(run.status, 0, `退出碼:\n${run.output}`);
});

// ---------------------------------------------------------------- S2:連續幾天

Given(/^a card was learned (\d+) days? ago and is at stage (\d+)$/, function (this: LearningWorld, days: string, stage: string) {
  const id = cardIdOf(1);
  writeReviews(this, {
    [id]: review({ stage: Number(stage) as 1, learned_at: addIsoDays(this.today, -Number(days)), next_due: this.today }),
  });
  st(this).seededCards = [id];
});

When('the person reviews it and passes on day 1', async function (this: LearningWorld) {
  const s = st(this);
  s.script = ['correct'];
  s.runs = [];
  const run = await runFreshSession(this);
  assert.equal(run.status, 0, `第一天的複習應該正常結束:\n${run.output}`);
  assert.equal(readReviews(this)[cardIdOf(1)]!.stage, 2, '第一天通過後應該進到 stage 2');
});

When('the clock advances {int} days', function (this: LearningWorld, days: number) {
  this.today = addIsoDays(this.today, days);
  st(this).runs = [];
});

Then('that card appears in the due list', function (this: LearningWorld) {
  const run = runDryRun(this);
  assert.equal(run.status, 0, run.output);
  assert.match(run.output, new RegExp(`${cardIdOf(1)}\\s+stage 2`), `到期清單裡應該有 ${cardIdOf(1)}(stage 2):\n${run.output}`);
});

Then('it is asked as an apply question in addition to a fill question', async function (this: LearningWorld) {
  const session = await buildSessionFor(this);
  const item = session.queue.find((d) => d.card === cardIdOf(1));
  assert.ok(item, '到期的 session 裡找不到這張卡');
  assert.deepEqual(item.types, ['fill', 'apply']);
});

// ---------------------------------------------------------------- S3:題型跟著 stage

Given('cards at stage 1, 2 and 3 are all due', function (this: LearningWorld) {
  const reviews: Record<CardId, Review> = {};
  [1, 2, 3].forEach((stage, i) => {
    reviews[cardIdOf(i + 1)] = review({ stage: stage as 1, learned_at: addIsoDays(this.today, -40), next_due: this.today });
  });
  writeReviews(this, reviews);
});

When('the review command builds the session', async function (this: LearningWorld) {
  st(this).session = await buildSessionFor(this);
});

function typesOfStage(world: LearningWorld, stage: number): string[] {
  const item = st(world).session!.queue.find((d) => d.stage === stage);
  assert.ok(item, `session 裡沒有 stage ${stage} 的卡`);
  return item.types;
}
Then('the stage 1 card is asked as fill only', function (this: LearningWorld) {
  assert.deepEqual(typesOfStage(this, 1), ['fill']);
});
Then('the stage 2 card is asked as fill and apply', function (this: LearningWorld) {
  assert.deepEqual(typesOfStage(this, 2), ['fill', 'apply']);
});
Then('the stage 3 card is asked as apply only', function (this: LearningWorld) {
  assert.deepEqual(typesOfStage(this, 3), ['apply']);
});

// ---------------------------------------------------------------- S4:填空題通常不呼叫 LLM

Given('a fill question whose answer is {string}', function (this: LearningWorld, answer: string) {
  st(this).fill = { prompt: 'The transport layer in the stack is called ___.', answers: [[answer]] };
});

When('the person answers {string}', async function (this: LearningWorld, typed: string) {
  const s = st(this);
  const result = await gradeFillQuestion(s.fill!, [typed], injectedRouter(this));
  s.fillResult = { pass: result.pass, grader: result.grader };
});

Then('no LLM call is recorded in the log', function (this: LearningWorld) {
  assert.equal(st(this).adapterCalls.length, 0, `雲端 adapter 被呼叫了:${JSON.stringify(st(this).adapterCalls)}`);
  const llm = ledgerEvents(this).filter((e) => e.type === 'llm_call');
  assert.equal(llm.length, 0, `帳本裡有 llm_call:${JSON.stringify(llm)}`);
  // 正面對照:這個斷言抓得到東西——應用題那條路會留下 llm_call(見 grader 場景)。
});

// ---------------------------------------------------------------- S5/S6:應用題走雲端(真 CLI)

/** data-layer.steps.ts 的「an apply question with {int} rubric criteria」在 @i2 分派到這裡。 */
export function seedI2ApplyQuestion(world: LearningWorld, rubricCount: number): void {
  seedApplyCard(world, 3, rubricCount);
}

When('the person submits an answer that satisfies all {int}', async function (this: LearningWorld, _n: number) {
  const s = st(this);
  s.script = ['long']; // 全部達成;雲端回的 feedback 超過 40 字,用來驗證被截短
  s.runs = [];
  await runFreshSession(this);
});

Then('the answer is accepted', async function (this: LearningWorld) {
  const s = st(this);
  if (s.fillResult) {
    assert.equal(s.fillResult.pass, true, `填空題應該通過:${JSON.stringify(s.fillResult)}`);
    return;
  }
  const run = await ensureRun(this);
  const card = s.applyCard!;
  const after = readReviews(this)[card]!;
  assert.equal(after.history.at(-1)?.pass, true, `應用題應該通過:${JSON.stringify(after)}\n${run.output}`);
  assert.equal(after.stage, 4, `stage 3 通過後應該進到 stage 4:${JSON.stringify(after)}`);
});

/** grading.steps.ts 的「the grader is recorded as {}」在 @i2 分派到這裡。 */
export function assertI2GraderRecorded(world: LearningWorld, expected: string): void {
  const s = states.get(world);
  assert.ok(s, '這個場景還沒做任何 I2 作答');
  assert.equal(expected, 'cloud', `I2 只會出現 cloud,收到「${expected}」`);
  const card = s.applyCard!;
  const entry = readReviews(world)[card]!.history.at(-1);
  assert.equal(entry?.grader, 'cloud', `reviews.json 最後一筆的 grader 應該是 cloud:${JSON.stringify(entry)}`);
  // 帳本佐證:真的有一筆 grade.apply 的雲端呼叫被記帳(假 fixture 路徑不會留下這一筆)
  const calls = ledgerEvents(world).filter((e) => e.type === 'llm_call' && e.task === 'grade.apply');
  assert.ok(calls.length >= 1, `帳本裡沒有 grade.apply 的 llm_call:${JSON.stringify(ledgerEvents(world))}`);
  assert.equal(calls[0]!.provider, 'openai');
  assert.ok(cloudRequests(world).length >= 1, '假雲端沒有收到任何請求:評分沒有走雲端');
}

Then('the feedback is at most {int} words', async function (this: LearningWorld, limit: number) {
  const run = await ensureRun(this);
  const lines = run.stdout.split('\n');
  const at = lines.findIndex((l) => l.includes(APPLY_PROMPT_MARK));
  assert.notEqual(at, -1, `輸出裡找不到應用題的作答提示:\n${run.output}`);
  const feedback = lines.slice(at + 1).find((l) => l.trim() !== '');
  assert.ok(feedback, `作答之後沒有印出 feedback:\n${run.output}`);
  assert.ok(countWords(feedback) > 0, 'feedback 不該是空的');
  assert.ok(countWords(feedback) <= limit, `feedback 超過 ${limit} 字(${countWords(feedback)}):${feedback}`);
});

When('an apply question is graded', async function (this: LearningWorld) {
  seedApplyCard(this, 3);
  const s = st(this);
  s.script = ['correct'];
  s.runs = [];
  await runFreshSession(this);
});

Then('it is still graded correctly', async function (this: LearningWorld) {
  const run = await ensureRun(this);
  const card = st(this).applyCard!;
  const after = readReviews(this)[card]!;
  assert.equal(run.status, 0, `fixtures 不在的時候 CLI 應該照常結束:\n${run.output}`);
  assert.equal(after.history.at(-1)?.pass, true, `應用題應該通過:${JSON.stringify(after)}\n${run.output}`);
  assert.equal(after.history.at(-1)?.grader, 'cloud');
  assert.ok(cloudRequests(this).length >= 1, '評分沒有走雲端');
  // 迴圈裡沒有 fake:Wave 0 的 FakeLlmRouter 檔案已經移除,而且 review/grade 入口與 session 建構不再引用它。
  assert.ok(!existsSync(join(ROOT, 'packages/core/src/grading/fake-llm.ts')), 'grading/fake-llm.ts 應該已經移除(05 的 Wave 0 重複,I2 整合時移除)');
  for (const file of ['scripts/review.ts', 'scripts/grade.ts', 'packages/core/src/session/build.ts']) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    assert.ok(!/FakeLlmRouter|fixtures\/llm|router-default-fake/.test(text), `${file} 不該再引用 FakeLlmRouter / contracts/fixtures/llm / router-default-fake`);
  }
});

// ---------------------------------------------------------------- S7:每日上限

Then('exactly {int} questions are presented', async function (this: LearningWorld, n: number) {
  const run = await ensureRun(this);
  const lines = questionLines(run.stdout);
  assert.equal(lines.length, n, `應該問了 ${n} 題,實際 ${lines.length}:\n${run.output}`);
  assert.ok(lines.every((l) => l.startsWith(`(`) && l.includes(`/${n}) `)), `分母應該是 ${n}:\n${lines.join('\n')}`);
});

Then('the remaining {int} are reported as deferred', async function (this: LearningWorld, n: number) {
  const run = await ensureRun(this);
  const m = /(\d+)\s*張延後/.exec(run.output);
  assert.ok(m, `輸出裡沒有「N 張延後」那一行:\n${run.output}`);
  assert.equal(Number(m[1]), n);
});

Then('the deferred cards keep their existing state', async function (this: LearningWorld) {
  await ensureRun(this);
  const s = st(this);
  const presented = new Set(s.presentedPerRun[0]);
  const after = readReviews(this);
  const deferred = (s.seededCards ?? []).filter((id) => !presented.has(id));
  assert.ok(deferred.length > 0, '沒有被延後的卡可以比對');
  for (const id of deferred) assert.deepEqual(after[id], s.reviewsBefore![id], `${id} 被延後,狀態不該變`);
  for (const id of presented) assert.notDeepEqual(after[id], s.reviewsBefore![id], `${id} 問過了,狀態應該變`);
});

// ---------------------------------------------------------------- S8:最脆弱的先問

Given(/^a stage (\d) card overdue by (\d+) days?$/, function (this: LearningWorld, stage: string, days: string) {
  const reviews = existsSync(reviewsFile(this)) ? readReviews(this) : {};
  const id = cardIdOf(Object.keys(reviews).length + 1);
  reviews[id] = review({ stage: Number(stage) as 1, learned_at: addIsoDays(this.today, -200), next_due: addIsoDays(this.today, -Number(days)) });
  writeReviews(this, reviews);
});

When('the session is built', async function (this: LearningWorld) {
  st(this).session = await buildSessionFor(this);
});

Then('the stage 1 card is presented before the stage 5 card', function (this: LearningWorld) {
  const queue = st(this).session!.queue;
  const first = queue.findIndex((d) => d.stage === 1);
  const fifth = queue.findIndex((d) => d.stage === 5);
  assert.ok(first >= 0 && fifth >= 0, `session 裡要有這兩張卡:${JSON.stringify(queue.map((d) => d.stage))}`);
  assert.ok(first < fifth, `stage 1 應該排在 stage 5 前面:${JSON.stringify(queue.map((d) => d.stage))}`);
});

// ---------------------------------------------------------------- S9:連錯兩次排 reteach

Given('a card has failed once and is due', function (this: LearningWorld) {
  const id = cardIdOf(1);
  writeReviews(this, {
    [id]: review({ stage: 1, learned_at: addIsoDays(this.today, -2), next_due: this.today, fails_in_row: 1, total_fails: 1 }),
  });
  st(this).seededCards = [id];
});

When('the person answers it incorrectly again', async function (this: LearningWorld) {
  const s = st(this);
  s.script = ['incorrect'];
  s.runs = [];
  await runFreshSession(this);
});

Then('the card is queued for reteach', async function (this: LearningWorld) {
  const id = cardIdOf(1);
  assert.equal(readReviews(this)[id]!.fails_in_row, 2, '連錯兩次之後 fails_in_row 應該是 2');
  const tomorrow = addIsoDays(this.today, 1);
  const session = await buildSessionFor(this, tomorrow);
  assert.ok(session.reteachQueue.includes(id), `隔天的 session 應該把 ${id} 排進 reteach:${JSON.stringify(session.reteachQueue)}`);
});

Then('the reteach does not consume the daily cap', async function (this: LearningWorld) {
  const id = cardIdOf(1);
  const tomorrow = addIsoDays(this.today, 1);
  // 隔天:再加 10 張一般到期的卡(sec-0002..sec-0011),上限 10。reteach 的提示不算一題。
  const ids = ensureCards(this, 11);
  const reviews = readReviews(this);
  for (const other of ids.slice(1)) reviews[other] = review({ stage: 1, learned_at: addIsoDays(tomorrow, -3), next_due: tomorrow });
  writeReviews(this, reviews);
  writeFileSync(join(dirOf(this), 'cards/security', `${id}.short.md`), '同源指協定、主機、埠號三者相同。\n', 'utf8');

  const session = await buildSessionFor(this, tomorrow);
  assert.ok(session.reteachQueue.includes(id), 'reteach 佇列應該有這張卡');
  let reteachShown = 0;
  const questionCards = new Set<CardId>();
  for (;;) {
    const presentation = await presentNextCard(session);
    if (presentation.kind === 'done') break;
    if (presentation.kind === 'reteach') {
      reteachShown += 1;
      continue;
    }
    questionCards.add(presentation.card);
    await submitAnswer(session, '');
  }
  assert.equal(reteachShown, 1, 'reteach 的提示應該顯示一次');
  assert.equal(questionCards.size, 10, `被問到的卡應該剛好是上限 10 張(reteach 的提示不占名額):${questionCards.size}`);
});

// ---------------------------------------------------------------- S10:批改錯誤不動卡片

Given('the cloud grader returns an unparseable response twice', function (this: LearningWorld) {
  seedApplyCard(this, 3);
  st(this).reviewsBefore = readReviews(this);
});

When('the person submits an apply answer', async function (this: LearningWorld) {
  const s = st(this);
  s.script = ['garbage'];
  s.runs = [];
  const before = s.reviewsBefore;
  await runFreshSession(this);
  s.reviewsBefore = before;
});

Then("the card's stage is unchanged", function (this: LearningWorld) {
  const s = st(this);
  const id = s.applyCard!;
  assert.deepEqual(readReviews(this)[id], s.reviewsBefore![id], `批改失敗,${id} 的紀錄不該有任何變動`);
});

Then("the card remains in today's list", function (this: LearningWorld) {
  const run = runDryRun(this);
  assert.equal(run.status, 0, run.output);
  assert.match(run.output, new RegExp(`${st(this).applyCard}\\s+stage 3`), `今天的清單裡應該還有這張卡:\n${run.output}`);
});

/** review-cli.steps.ts 的「the session reports that grading failed」在 @i2 分派到這裡。 */
export async function assertI2GradingFailedReported(world: LearningWorld): Promise<void> {
  const run = await ensureRun(world);
  assert.equal(run.status, 0, `批改失敗不該讓整個指令失敗:\n${run.output}`);
  assert.match(run.output, /Retry later: 1 question\(s\)\./, `小結應該報告有一題待重試(批改失敗):\n${run.output}`);
  assert.match(run.output, /0 passed, 0 returned\./);
  // 雲端被問了剛好兩次(第一次無法解析,重試一次,仍無法解析才放棄)
  assert.equal(cloudRequests(world).length, 2, `應該問了兩次:${cloudRequests(world).length}`);
}

// ---------------------------------------------------------------- S11:中斷後續做

Given('{int} cards are due and the person answered {int}', async function (this: LearningWorld, due: number, answered: number) {
  seedI2CardsDue(this, due);
  const s = st(this);
  s.script = Array.from({ length: answered }, () => 'correct' as const);
  s.onExhausted = 'eof'; // 作答完那幾題就離開(stdin 結束)
  s.runs = [];
  await runFreshSession(this);
  assert.equal(s.presentedPerRun[0]!.length >= answered, true, `第一輪至少要問 ${answered} 張:\n${s.runs[0]!.output}`);
});

When('the person quits and runs the review command again the same day', async function (this: LearningWorld) {
  const s = st(this);
  s.script = ['correct', 'correct', 'correct', 'correct', 'correct'];
  s.onExhausted = 'empty';
  await runFreshSession(this);
});

Then('the session resumes at the third card', function (this: LearningWorld) {
  const s = st(this);
  const first = s.presentedPerRun[0]!;
  const second = s.presentedPerRun[1]!;
  const reviews = readReviews(this);
  const answered = first.filter((id) => reviews[id]!.history.length >= 1 && (s.reviewsBefore![id]?.history.length ?? 0) === 0);
  void answered;
  assert.equal(second.length, 3, `第二輪應該只剩 3 張:${JSON.stringify(second)}`);
  const firstLine = questionLines(s.runs[1]!.stdout)[0]!;
  assert.ok(firstLine.startsWith('(1/3) '), `第二輪應該從 (1/3) 開始:${firstLine}`);
  for (const id of second) assert.ok(!first.slice(0, 2).includes(id), `${id} 在第一輪已經答過,不該再問`);
});

Then('the same {int} cards are used', function (this: LearningWorld, n: number) {
  const s = st(this);
  const used = new Set([...s.presentedPerRun[0]!.slice(0, 2), ...s.presentedPerRun[1]!]);
  assert.equal(used.size, n, `兩輪合起來應該剛好是同樣的 ${n} 張:${JSON.stringify([...used])}`);
  assert.deepEqual([...used].sort(), [...s.seededCards].sort());
});

// ---------------------------------------------------------------- S12:內容管線沒壞(照 I1)

When('the person ingests a new raw file', function (this: LearningWorld) {
  const s = st(this);
  s.ingestOut = mkdtempSync(join(tmpdir(), 'lc-i2-ingest-'));
  const env = { ...childEnv(this), LLM_CLOUD_PROVIDER: 'anthropic', LLM_CLOUD_MODEL: 'test-model', ANTHROPIC_API_KEY: 'test-anthropic-key', FAKE_CLOUD_LEVEL0_COUNT: '3' };
  // 這一路和 I1 的 CLI 場景同一個假網路層(_fake-cloud.mjs):scripts/ingest.ts 沒有注入點。
  s.ingestRun = this.runCommand(
    `npx tsx --import ./features/steps/_fake-cloud.mjs scripts/ingest.ts --file contracts/fixtures/raw/security-basics.md --out "${s.ingestOut}" --category security`,
    { env, timeoutMs: 180_000 },
  );
});

Then('cards, questions and order are produced as in I1', function (this: LearningWorld) {
  const s = st(this);
  const run = s.ingestRun!;
  const out = s.ingestOut!;
  assert.equal(run.status, 0, `ingest 應該成功:\n${run.output}`);
  const cardDir = join(out, 'cards/security');
  const cards = readdirSync(cardDir).filter((n) => n.endsWith('.md') && !n.endsWith('.short.md')).map((n) => n.slice(0, -3));
  assert.ok(cards.length >= 3, `應該至少有 3 張卡:${JSON.stringify(cards)}`);
  for (const id of cards) assert.ok(existsSync(join(out, 'questions', `${id}.yaml`)), `${id} 缺考題檔`);
  const order = JSON.parse(readFileSync(join(out, 'graph/order-security.json'), 'utf8')) as unknown;
  const flat = JSON.stringify(order);
  for (const id of cards) assert.ok(flat.includes(id), `順序檔裡沒有 ${id}:${flat}`);
});
