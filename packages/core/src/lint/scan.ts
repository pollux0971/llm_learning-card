/**
 * 讀一個 learning/ 目錄(或它的 fixture)進記憶體,不做任何檢查判斷——
 * 判斷邏輯在 checks.ts。只讀不寫。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parseCard, type ParsedCard } from './validator-min.js';

export interface ScannedCard {
  id: string;
  category: string;
  path: string;
  parsed: ParsedCard;
}

export interface ScannedQuestionFile {
  /** 檔名(不含副檔名) */
  id: string;
  /** yaml 內 card 欄位所指的卡片 id */
  card: string;
  path: string;
}

export interface Graph {
  nodes: string[];
  edges: [string, string][];
}

export interface ScannedDir {
  root: string;
  cards: ScannedCard[];
  questions: ScannedQuestionFile[];
  graphs: Record<string, Graph>;
  reviews: Record<string, unknown>;
}

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

function listFiles(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listFiles(full, suffix));
    else if (name.endsWith(suffix)) out.push(full);
  }
  return out;
}

export function scanDir(root: string): ScannedDir {
  const cards: ScannedCard[] = [];
  for (const file of listFiles(join(root, 'cards'), '.md')) {
    if (file.endsWith('.short.md')) continue;
    const rel = toPosix(relative(root, file));
    const parsed = parseCard(readFileSync(file, 'utf8'));
    cards.push({ id: parsed.frontmatter.id, category: parsed.frontmatter.category, path: rel, parsed });
  }

  const questions: ScannedQuestionFile[] = [];
  const qDir = join(root, 'questions');
  if (existsSync(qDir)) {
    for (const name of readdirSync(qDir)) {
      if (!name.endsWith('.yaml')) continue;
      const full = join(qDir, name);
      const data = parseYaml(readFileSync(full, 'utf8')) as { card?: string };
      questions.push({ id: name.replace(/\.yaml$/, ''), card: data.card ?? '', path: toPosix(relative(root, full)) });
    }
  }

  let graphs: Record<string, Graph> = {};
  const graphPath = join(root, 'graph/deps.json');
  if (existsSync(graphPath)) {
    graphs = JSON.parse(readFileSync(graphPath, 'utf8')) as Record<string, Graph>;
  }

  let reviews: Record<string, unknown> = {};
  const reviewsPath = join(root, 'state/reviews.json');
  if (existsSync(reviewsPath)) {
    reviews = JSON.parse(readFileSync(reviewsPath, 'utf8')) as Record<string, unknown>;
  }

  return { root, cards, questions, graphs, reviews };
}

/**
 * 「掃了幾個東西」的清點。scanDir 回傳的是**內容**,這裡回傳的是**數量與結構
 * 狀態**——兩者的差別就是「0 problems found.」跟「掃描 1 個類別、3 張卡」的差別。
 *
 * 為什麼要分開一個函式:scanDir 對「cards/ 不存在」與「cards/ 在但裡面是空的」
 * 一視同仁,兩種都只是回傳 `cards: []`。使用者要修的東西完全不同(一個是路徑
 * 打錯,一個是卡片檔案消失),所以診斷需要目錄層級的事實,不是只有筆數。
 */
export interface DirInventory {
  /** --dir 指到的目錄本身在不在 */
  rootExists: boolean;
  /** `<root>/cards` 在不在 */
  cardsDirExists: boolean;
  /** `cards/` 底下的類別子目錄名,排序過 */
  categories: string[];
  /** 那些一個 `.md` 都沒有的類別目錄名,排序過 */
  emptyCategories: string[];
  /** 卡片數(不含 `.short.md`,跟 scanDir 同一條規則) */
  cards: number;
  /** `questions/*.yaml` 的份數 */
  questions: number;
  /** `graph/deps.json` 在不在 */
  depsFile: boolean;
  /** `graph/order-*.json` 的檔名,排序過 */
  orderFiles: string[];
}

function subdirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .sort();
}

/** 只看數量與結構,不 parse 任何卡片內容——壞掉的卡片不該讓清點本身炸掉。 */
export function inventory(root: string): DirInventory {
  const cardsDir = join(root, 'cards');
  const categories = subdirs(cardsDir);
  const cardsPerCategory = new Map<string, number>();
  for (const category of categories) {
    const files = listFiles(join(cardsDir, category), '.md').filter((f) => !f.endsWith('.short.md'));
    cardsPerCategory.set(category, files.length);
  }

  const qDir = join(root, 'questions');
  const questions = existsSync(qDir) ? readdirSync(qDir).filter((n) => n.endsWith('.yaml')).length : 0;

  const graphDir = join(root, 'graph');
  const orderFiles = existsSync(graphDir)
    ? readdirSync(graphDir)
        .filter((n) => n.startsWith('order-') && n.endsWith('.json'))
        .sort()
    : [];

  return {
    rootExists: existsSync(root),
    cardsDirExists: existsSync(cardsDir),
    categories,
    emptyCategories: categories.filter((c) => cardsPerCategory.get(c) === 0),
    cards: [...cardsPerCategory.values()].reduce((a, b) => a + b, 0),
    questions,
    depsFile: existsSync(join(root, 'graph/deps.json')),
    orderFiles,
  };
}
