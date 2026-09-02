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
