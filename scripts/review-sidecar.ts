/**
 * 複習側車入口(ADR-075)。stdio 一行一則 JSON,五個動作。
 * 用法: node --import tsx scripts/review-sidecar.ts --dir <learning 根>
 *
 * 第一個 import 必須是 review-sidecar-stdio(把 console 導到 stderr),_env 排第二。
 */
import './review-sidecar-stdio.js';
import { loadDotEnv } from './_env.js';
import { realpathSync, writeSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createLiveGatewayRouter, defaultVaultDeps, missingGradingKeys, resolveVerifiedLedger } from '../packages/core/src/llm/index.js';
import { ReviewStartError, createReviewHandler } from '../packages/core/src/session/handler.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function localToday(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

interface LineReader {
  next(): Promise<string | undefined>;
}

/** 只用 \\n 分行。字串裡的 U+2028 / U+2029 與 \\r 都留在同一行裡交給 handler。 */
function readLines(stream: NodeJS.ReadableStream): LineReader {
  let buf = '';
  const pending: string[] = [];
  let ended = false;
  let waiter: (() => void) | undefined;
  const wake = (): void => {
    const current = waiter;
    waiter = undefined;
    current?.();
  };
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    buf += chunk;
    let at = buf.indexOf('\n');
    while (at >= 0) {
      pending.push(buf.slice(0, at));
      buf = buf.slice(at + 1);
      at = buf.indexOf('\n');
    }
    wake();
  });
  stream.on('end', () => {
    ended = true;
    wake();
  });
  stream.on('error', () => {
    ended = true;
    wake();
  });
  return {
    async next(): Promise<string | undefined> {
      while (pending.length === 0 && !ended) {
        await new Promise<void>((resolve) => {
          waiter = resolve;
        });
      }
      if (pending.length > 0) return pending.shift();
      if (buf.length > 0) {
        const rest = buf;
        buf = '';
        return rest;
      }
      return undefined;
    },
  };
}

/** pipe 上的 stderr 會緩衝;測試在行程還活著時就讀,所以用同步寫。 */
function stderrLine(text: string): void {
  writeSync(process.stderr.fd, `${text}\n`);
}

function noteError(line: string): void {
  try {
    const parsed = JSON.parse(line) as { ok?: unknown; error?: { kind?: unknown } };
    if (parsed.ok === false && typeof parsed.error?.kind === 'string') {
      stderrLine(`[review-sidecar] ${parsed.error.kind}`);
    }
  } catch {
    stderrLine('[review-sidecar] internal');
  }
}

async function main(): Promise<void> {
  const fake = process.env.LC_REVIEW_FAKE_CLOUD;
  if (fake !== undefined && fake !== '') {
    await import(pathToFileURL(fake).href);
    stderrLine('[review-sidecar] 正在用假 router');
  }

  const todayRaw = process.env.LC_REVIEW_TODAY;
  if (todayRaw !== undefined && !DATE_RE.test(todayRaw)) {
    stderrLine('[review-sidecar] bad-today');
    process.exit(2);
  }
  const helloToday = todayRaw === undefined ? localToday() : todayRaw;
  const handlerToday: string | (() => string) = todayRaw === undefined ? localToday : todayRaw;

  const learningDir = arg('--dir');
  if (!learningDir) {
    stderrLine('[review-sidecar] bad-dir');
    process.exit(2);
  }

  const hello = { v: 1, kind: 'hello', fakeCloud: Boolean(fake), today: helloToday };
  process.stdout.write(`${JSON.stringify(hello)}\n`);

  const handler = createReviewHandler({
    learningDir,
    today: handlerToday,
    env: process.env,
    reloadEnv: loadDotEnv,
    missingKeys: () => missingGradingKeys(process.env),
    routerFactory: () => {
      const resolved = resolveVerifiedLedger(defaultVaultDeps());
      if (!resolved.ok) throw new ReviewStartError('router-unavailable');
      if (real(resolved.ledger.learningDir) !== real(learningDir)) throw new ReviewStartError('root-mismatch');
      return createLiveGatewayRouter({ ledger: resolved.ledger });
    },
  });

  const lines = readLines(process.stdin);
  for (;;) {
    const line = await lines.next();
    if (line === undefined) break;
    const response = await handler(line);
    noteError(response);
    process.stdout.write(`${response}\n`);
  }
}

main().catch(() => {
  stderrLine('[review-sidecar] internal');
  process.exit(1);
});
