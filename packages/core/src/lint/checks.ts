/**
 * 每個檢查一個純函式:(ScannedDir) => LintProblem[]。不讀檔、不寫檔。
 */
import type { ScannedDir, Graph } from './scan.js';
import type { LintProblem, LintResult, LintStatus } from './types.js';
import { countBodyWords } from './validator-min.js';

/** 教學卡 body 字數上限,契約 §2 硬約定,不是 settings.short_body_limit(那是縮短版用的) */
const BODY_WORD_LIMIT = 100;

export function checkBodyLimit(scanned: ScannedDir): LintProblem[] {
  const problems: LintProblem[] = [];
  for (const c of scanned.cards) {
    const n = countBodyWords(c.parsed.body);
    if (n > BODY_WORD_LIMIT) {
      problems.push({
        type: 'body_over_limit',
        card: c.id,
        path: c.path,
        detail: `body 字數 ${n},上限 ${BODY_WORD_LIMIT}`,
      });
    }
  }
  return problems;
}

export function checkMissingQuestions(scanned: ScannedDir): LintProblem[] {
  const withQuestions = new Set(scanned.questions.map((q) => q.id));
  const problems: LintProblem[] = [];
  for (const c of scanned.cards) {
    if (!withQuestions.has(c.id)) {
      problems.push({
        type: 'missing_questions',
        card: c.id,
        path: c.path,
        detail: `缺少 questions/${c.id}.yaml`,
      });
    }
  }
  return problems;
}

export function checkOrphanQuestions(scanned: ScannedDir): LintProblem[] {
  const cardIds = new Set(scanned.cards.map((c) => c.id));
  const problems: LintProblem[] = [];
  for (const q of scanned.questions) {
    if (!cardIds.has(q.card)) {
      problems.push({
        type: 'orphan_questions',
        card: q.card,
        path: q.path,
        detail: `考題檔對應的卡片 ${q.card} 不存在`,
      });
    }
  }
  return problems;
}

export function checkMissingPrereqs(scanned: ScannedDir): LintProblem[] {
  const cardIds = new Set(scanned.cards.map((c) => c.id));
  const problems: LintProblem[] = [];
  for (const c of scanned.cards) {
    for (const p of c.parsed.frontmatter.prereqs ?? []) {
      if (!cardIds.has(p)) {
        problems.push({
          type: 'missing_prereq',
          card: c.id,
          path: c.path,
          detail: `prereq ${p} 不存在`,
        });
      }
    }
  }
  return problems;
}

export function checkOrphanChildren(scanned: ScannedDir): LintProblem[] {
  const cardIds = new Set(scanned.cards.map((c) => c.id));
  const problems: LintProblem[] = [];
  for (const c of scanned.cards) {
    const parent = c.parsed.frontmatter.parent;
    if (parent && !cardIds.has(parent)) {
      problems.push({
        type: 'orphan_child',
        card: c.id,
        path: c.path,
        detail: `parent ${parent} 不存在`,
      });
    }
  }
  return problems;
}

function buildAdjacency(graph: Graph): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) adj.set(n, []);
  for (const [from, to] of graph.edges) {
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from)!.push(to);
  }
  return adj;
}

/** DFS 白灰黑三色找一條迴圈路徑;沒有迴圈回傳 null */
function findCyclePath(adj: Map<string, string[]>): string[] | null {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const n of adj.keys()) color.set(n, WHITE);
  const stack: string[] = [];

  function dfs(node: string): string[] | null {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of adj.get(node) ?? []) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) {
        const idx = stack.indexOf(next);
        return [...stack.slice(idx), next];
      }
      if (c === WHITE) {
        const found = dfs(next);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(node, BLACK);
    return null;
  }

  for (const n of adj.keys()) {
    if (color.get(n) === WHITE) {
      const found = dfs(n);
      if (found) return found;
    }
  }
  return null;
}

export function findCycles(scanned: ScannedDir): LintProblem[] {
  const problems: LintProblem[] = [];
  for (const [category, graph] of Object.entries(scanned.graphs)) {
    const path = findCyclePath(buildAdjacency(graph));
    if (path) {
      problems.push({
        type: 'cycle',
        path: 'graph/deps.json',
        detail: `${category}: ${path.join(' → ')}`,
      });
    }
  }
  return problems;
}

/** 迴圈上的每個節點,cycle 已經把整條路徑講清楚了,不需要 prereq_mismatch 再重複報一次 */
function cycleMemberIds(scanned: ScannedDir): Set<string> {
  const members = new Set<string>();
  for (const graph of Object.values(scanned.graphs)) {
    const path = findCyclePath(buildAdjacency(graph));
    if (path) for (const id of path) members.add(id);
  }
  return members;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/** 卡片 frontmatter 的 prereqs 是否跟 graph/deps.json 的 edges 一致 */
export function checkPrereqMismatch(scanned: ScannedDir): LintProblem[] {
  const problems: LintProblem[] = [];
  const cycleIds = cycleMemberIds(scanned);
  const cardById = new Map(scanned.cards.map((c) => [c.id, c] as const));

  for (const graph of Object.values(scanned.graphs)) {
    const expectedByCard = new Map<string, Set<string>>();
    for (const [from, to] of graph.edges) {
      if (!expectedByCard.has(to)) expectedByCard.set(to, new Set());
      expectedByCard.get(to)!.add(from);
    }
    for (const nodeId of graph.nodes) {
      if (cycleIds.has(nodeId)) continue;
      const card = cardById.get(nodeId);
      if (!card) continue;
      const expected = expectedByCard.get(nodeId) ?? new Set<string>();
      const actual = new Set(card.parsed.frontmatter.prereqs ?? []);
      if (!sameSet(expected, actual)) {
        problems.push({
          type: 'prereq_mismatch',
          card: nodeId,
          path: card.path,
          detail: `prereqs 為 [${[...actual].join(', ')}],graph 顯示應為 [${[...expected].join(', ')}]`,
        });
      }
    }
  }
  return problems;
}

export function checkReviewOrphans(scanned: ScannedDir): LintProblem[] {
  const cardIds = new Set(scanned.cards.map((c) => c.id));
  const problems: LintProblem[] = [];
  for (const id of Object.keys(scanned.reviews)) {
    if (!cardIds.has(id)) {
      problems.push({
        type: 'review_orphan',
        card: id,
        path: 'state/reviews.json',
        detail: `複習狀態裡的卡片 ${id} 不存在`,
      });
    }
  }
  return problems;
}

export function checkStatuses(scanned: ScannedDir): LintStatus[] {
  const statuses: LintStatus[] = [];
  for (const c of scanned.cards) {
    if (c.parsed.frontmatter.stale) statuses.push({ type: 'stale', card: c.id, path: c.path });
    if (c.parsed.frontmatter.source_missing) statuses.push({ type: 'source_missing', card: c.id, path: c.path });
  }
  return statuses;
}

export function runChecks(scanned: ScannedDir): LintResult {
  const problems = [
    ...checkBodyLimit(scanned),
    ...checkMissingQuestions(scanned),
    ...checkOrphanQuestions(scanned),
    ...checkMissingPrereqs(scanned),
    ...checkOrphanChildren(scanned),
    ...findCycles(scanned),
    ...checkPrereqMismatch(scanned),
    ...checkReviewOrphans(scanned),
  ];
  return { problems, statuses: checkStatuses(scanned) };
}
