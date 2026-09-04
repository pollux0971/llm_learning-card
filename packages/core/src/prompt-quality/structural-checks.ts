/**
 * 結構性檢查:只驗格式,不判斷品質(FEATURE.md「不在範圍」)。
 * 對象是 LLM 任務輸出的原始文字,一律預期是 JSON。認得的形狀:
 *   - 教學卡陣列項目:有 `body` 欄位 → 檢查 title/body 存在、body 字數 <= 100
 *   - apply 題目:有 `rubric` 陣列 → 檢查長度 2..4、prompt 存在
 *   - apply 評分結果:有 `criteria` 陣列 → 檢查長度 2..4(criteria.length === rubric.length,見契約 §5)
 *   - fill 題目:有 `prompt` 字串與 `answers` 陣列 → 檢查 `___` 數量與 answers 數量一致
 * 遞迴掃描整個 JSON 樹,任何符合形狀的節點都會被檢查。
 */
import { countBodyWords } from './word-count.js';
import type {
  BatchCard,
  BatchCheckResult,
  DuplicatePair,
  DuplicateReport,
  PrereqShapeViolation,
  StructuralIssue,
  StructuralCheckResult,
} from './types.js';

const BODY_WORD_LIMIT = 100;
const BLANK_MARKER = /___/g;

function checkCardShape(obj: Record<string, unknown>, issues: StructuralIssue[]): void {
  if (typeof obj.body !== 'string') return;
  if (!obj.title || typeof obj.title !== 'string') {
    issues.push({ kind: 'missing-field', detail: 'card 缺少 title' });
  }
  const count = countBodyWords(obj.body);
  if (count > BODY_WORD_LIMIT) {
    issues.push({ kind: 'body-too-long', detail: `body 字數 ${count} 超過上限 ${BODY_WORD_LIMIT}` });
  }
}

function checkRubricShape(obj: Record<string, unknown>, issues: StructuralIssue[]): void {
  if (!Array.isArray(obj.rubric)) return;
  if (!obj.prompt || typeof obj.prompt !== 'string') {
    issues.push({ kind: 'missing-field', detail: 'apply 題目缺少 prompt' });
  }
  if (obj.rubric.length < 2) {
    issues.push({ kind: 'rubric-too-few', detail: `rubric 只有 ${obj.rubric.length} 條,至少要 2 條` });
  } else if (obj.rubric.length > 4) {
    issues.push({ kind: 'rubric-too-many', detail: `rubric 有 ${obj.rubric.length} 條,最多 4 條` });
  }
}

function checkCriteriaShape(obj: Record<string, unknown>, issues: StructuralIssue[]): void {
  if (!Array.isArray(obj.criteria)) return;
  if (obj.criteria.length < 2) {
    issues.push({ kind: 'rubric-too-few', detail: `criteria 只有 ${obj.criteria.length} 項,rubric 至少要 2 條` });
  } else if (obj.criteria.length > 4) {
    issues.push({ kind: 'rubric-too-many', detail: `criteria 有 ${obj.criteria.length} 項,rubric 最多 4 條` });
  }
}

function checkFillShape(obj: Record<string, unknown>, issues: StructuralIssue[]): void {
  if (typeof obj.prompt !== 'string' || !Array.isArray(obj.answers)) return;
  const blanks = (obj.prompt.match(BLANK_MARKER) ?? []).length;
  if (blanks !== obj.answers.length) {
    issues.push({
      kind: 'blank-answer-mismatch',
      detail: `prompt 有 ${blanks} 個 ___,但 answers 有 ${obj.answers.length} 組`,
    });
  }
  if (obj.answers.some((a) => !Array.isArray(a) || a.length === 0)) {
    issues.push({ kind: 'missing-field', detail: '有一組 answers 是空的' });
  }
}

function walk(node: unknown, issues: StructuralIssue[]): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, issues);
    return;
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    checkCardShape(obj, issues);
    checkRubricShape(obj, issues);
    checkCriteriaShape(obj, issues);
    checkFillShape(obj, issues);
    for (const value of Object.values(obj)) walk(value, issues);
  }
}

export function checkStructural(outputText: string): StructuralIssue[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch (e) {
    return [{ kind: 'invalid-json', detail: (e as Error).message }];
  }
  const issues: StructuralIssue[] = [];
  walk(parsed, issues);
  return issues;
}

export const QUALITY_NOTE =
  '結構性檢查只抓機械性的失敗(字數、JSON 合法性、rubric 條數、空格與答案數一致);內容對不對、是不是一個概念,需要人來評分。';

export function runStructuralChecks(outputText: string): StructuralCheckResult {
  return { issues: checkStructural(outputText), note: QUALITY_NOTE };
}

// ================================================== phase-2:批次結構性檢查
//
// 上面那些檢查看的是「一個輸出」;下面兩項看的是「同一批」——同一類別一次 ingest
// 產出的所有卡放在一起才算得出來。判定的仍然是形狀,不是品質(ADR-032):
// 重複率算的是字面重複,圖形狀算的是 level 與 prereq 的方向,兩者都不需要人也不需要模型。
//
// 為什麼跟單一輸出的檢查放同一個檔:它們是同一個體系——同一組 StructuralIssue、
// 同一句 QUALITY_NOTE、同樣「只驗形狀」的界線。分成兩個檔會讓「結構性檢查有哪些」
// 這個問題有兩個答案。

/**
 * 兩個可調的常數集中在這裡,不要散進程式(工單第 2 項:golden 跑兩次後要調閾值)。
 *
 * 閾值邊界:**>= 才算重複**,剛好等於 0.6 算一對。理由是工單寫的是「Jaccard >= 0.6」,
 * 而且「剛好到門檻」在偵測性檢查裡應該是報出來、讓人看一眼,不是靜靜放過。
 * 這條邊界有專門的測試(batch-checks.test.ts 的「剛好 0.6」與「剛好差一格」兩例),
 * 因為 `>` / `>=` 正是變異測試第一個會換掉的地方。
 */
export const DUPLICATE_BODY_JACCARD_THRESHOLD = 0.6;
export const DUPLICATE_NGRAM_SIZE = 3;

/**
 * 標題正規化。規則(依序,全部都要):
 *   1. Unicode NFKC —— 全形英數與半形視為同一個字(`ＣＯＲＳ` === `CORS`)
 *   2. 轉小寫 —— `CORS` === `cors`
 *   3. 去掉所有空白 —— 含半形空白、tab、換行與全形空白 U+3000
 *   4. 去掉所有標點與符號(Unicode P* 與 S*) —— `CORS 預檢請求` === `CORS-預檢請求`
 *      === `「CORS 預檢請求」`
 *
 * 標題才這樣剝。body 不剝標點(見 normalizeBody),因為標點在正文裡帶訊息,
 * 剝掉會把不一樣的句子拉近、灌水相似度;標題短,剝掉才對得起「同一個標題」的直覺。
 */
export function normalizeTitle(title: string): string {
  throw new Error('not implemented (12-prompt-quality/phase-2)');
}

/**
 * body 正規化:移除 example 圍欄 → NFKC → 小寫 → 去掉所有空白。**保留標點**(理由見
 * normalizeTitle)。移除圍欄是契約 §2 的規則:圍欄不算字數,也不該參與重複率比對
 * ——兩張卡引用同一段程式碼不代表它們在講同一件事。
 */
export function normalizeBody(body: string): string {
  throw new Error('not implemented (12-prompt-quality/phase-2)');
}

/** 字元 n-gram 集合。字串短於 n 時回傳整個字串當唯一一個 gram,不回空集合。 */
export function charNgrams(text: string, n: number = DUPLICATE_NGRAM_SIZE): Set<string> {
  throw new Error('not implemented (12-prompt-quality/phase-2)');
}

/** Jaccard 相似度 |A∩B| / |A∪B|。兩邊都空時定義為 0(沒有內容就沒有重複可言)。 */
export function jaccard(a: Set<string>, b: Set<string>): number {
  throw new Error('not implemented (12-prompt-quality/phase-2)');
}

/**
 * 重複率:同一批的卡**兩兩比**,符合任一條就算一對——
 *   1. 標題正規化後相同(normalizeTitle)
 *   2. body 的字元 3-gram Jaccard >= DUPLICATE_BODY_JACCARD_THRESHOLD
 * 同一對只算一次,reason 以標題優先(標題相同是更強的證據)。
 *
 * 輸出「重複對數 / 卡數」與清單。golden 的目標是 0 對。
 *
 * 已知限制(I1 實測,見 FEATURE.md):這是**字面**重複的代理,抓不到中文改寫式的
 * 語意重複。I1-REVIEW §8.1 那 4 對人判的近重複在這個指標上是 0.019–0.132,
 * 而且沒有任何閾值能把它們跟非重複的對分開。那 4 對屬於人打分的範圍,不是這裡。
 */
export interface DuplicateOptions {
  /** 預設 DUPLICATE_BODY_JACCARD_THRESHOLD。golden 跑兩次之後要調的就是這個 */
  threshold?: number;
  /** 預設 DUPLICATE_NGRAM_SIZE */
  ngramSize?: number;
}

export function checkDuplicates(cards: BatchCard[], opts: DuplicateOptions = {}): DuplicateReport {
  throw new Error('not implemented (12-prompt-quality/phase-2)');
}

/**
 * 圖形狀:一張卡的 prereq 指向 **level 比自己深**的卡就算一筆(主卡依賴別人的子卡,
 * 教學順序會先教子卡)。I1-REVIEW §8.2 講的 L0 卡 prereq 含 L1 卡是這條的特例。
 * prereq 指向不存在的 id 不在這裡報——那是 09-lint 的斷鏈檢查,不是形狀問題。
 * 目標 0 筆。
 */
export function checkPrereqShape(cards: BatchCard[]): PrereqShapeViolation[] {
  throw new Error('not implemented (12-prompt-quality/phase-2)');
}

/**
 * 兩項批次檢查合起來跑,結果進既有的 StructuralIssue 體系:
 * 每一對重複一筆 'duplicate-pair',每一筆圖形狀一筆 'prereq-shape',
 * note 仍然是 QUALITY_NOTE(這兩項也不判斷品質)。
 */
export function runBatchChecks(cards: BatchCard[], opts: DuplicateOptions = {}): BatchCheckResult {
  throw new Error('not implemented (12-prompt-quality/phase-2)');
}
