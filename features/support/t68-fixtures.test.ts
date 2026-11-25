/**
 * T68(07 phase-6 問 AI)工單第 9 點:`contracts/fixtures/llm/` 的預錄回應(給 FakeLlmRouter / fixture-router 重播)與 `contracts/fixtures/README.md` 的一行。
 * 測試 agent 寫;開發 worker 不改。
 *
 * 工單寫 `contracts/fixtures/llm/teach.ask.json`、「一組好回答、一組壞回答、一組追問 3 個、一組追問 0 個」。但 `loadFixturesFromDir` 一個檔案只收**一筆**
 * 預錄(`{ task, prompt_contains, attempt, response }`),檔名格式是 `<task>.<情境>.json`(fixtures/README.md「規則」)。所以這裡的量法是:
 *   - `teach.ask.<情境>.json` 至少四個檔,每個檔就是一筆合法的 FixtureEntry,task 是 teach.ask、attempt 是 1;
 *   - 四種情形各有:好回答(追問 1–2 個)、壞回答(parseAskAnswer 讀不懂)、追問剛好 3 個、追問 0 個(後兩個也是好回答);
 *   - prompt_contains 在 teach.ask 底下互不相同、互不為子字串(重播靠它選檔,最長的勝);
 *   - fixtures/README.md 清單裡有 teach.ask 的一行(寫「問 AI」的回應)。
 * 這個檔不 import 還沒寫的模組:parseAskAnswer 用算出來的 file URL 動態 import,基底上是「功能還沒有」而紅,不是 tsc 錯。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadFixturesFromDir, type FixtureEntry } from './fixture-router.js';

const ROOT = join(import.meta.dirname, '../..');
const DIR = join(ROOT, 'contracts/fixtures/llm');
const ASK_URL = pathToFileURL(join(ROOT, 'packages/core/src/teach/ask.ts')).href;

interface AskModule {
  parseAskAnswer(text: string): { ok: boolean; value?: { followups: string[] } };
}

function askFiles(): string[] {
  return readdirSync(DIR).filter((n) => /^teach\.ask\..+\.json$/.test(n));
}

describe('T68 預錄回應:teach.ask', () => {
  it('至少四個 teach.ask.<情境>.json;每個檔是一筆 FixtureEntry、task 是 teach.ask、attempt 是 1、有 prompt_contains 與回應文字', () => {
    const files = askFiles();
    expect(files.length, `contracts/fixtures/llm/ 要有 teach.ask.<情境>.json(現在:${files.join(', ') || '沒有'})`).toBeGreaterThanOrEqual(4);
    for (const name of files) {
      const entry = JSON.parse(readFileSync(join(DIR, name), 'utf8')) as FixtureEntry;
      expect(entry.task, name).toBe('teach.ask');
      expect(entry.attempt, name).toBe(1);
      expect(typeof entry.prompt_contains, name).toBe('string');
      expect(entry.prompt_contains.length, name).toBeGreaterThan(0);
      expect(typeof entry.response.text, name).toBe('string');
    }
  });

  it('loadFixturesFromDir 讀得進來,teach.ask 的 prompt_contains 互不相同、互不為子字串', () => {
    const asks = loadFixturesFromDir(DIR).filter((f) => f.task === 'teach.ask');
    expect(asks.length).toBeGreaterThanOrEqual(4);
    const marks = asks.map((f) => f.prompt_contains);
    expect(new Set(marks).size).toBe(marks.length);
    for (const a of marks) for (const b of marks) if (a !== b) expect(b.includes(a), `${a} ⊂ ${b}`).toBe(false);
  });

  it('四種情形都有:好回答(追問 1–2 個)、壞回答(讀不懂)、追問剛好 3 個的好回答、沒有追問的好回答', async () => {
    const { parseAskAnswer } = (await import(/* @vite-ignore */ ASK_URL)) as AskModule;
    const asks = loadFixturesFromDir(DIR).filter((f) => f.task === 'teach.ask');
    const parsed = asks.map((f) => parseAskAnswer(f.response.text));
    const goodCounts = parsed.filter((p) => p.ok).map((p) => p.value!.followups.length);
    expect(parsed.some((p) => !p.ok), '要有一筆壞回答').toBe(true);
    expect(goodCounts.some((n) => n === 3), '追問 3 個').toBe(true);
    expect(goodCounts.some((n) => n === 0), '追問 0 個').toBe(true);
    expect(goodCounts.some((n) => n === 1 || n === 2), '一般的好回答(追問 1–2 個)').toBe(true);
  });

  it('fixtures/README.md 的清單提到 teach.ask(問 AI 的預錄回應)', () => {
    const readme = join(ROOT, 'contracts/fixtures/README.md');
    expect(existsSync(readme)).toBe(true);
    expect(readFileSync(readme, 'utf8')).toMatch(/teach\.ask/);
  });
});
