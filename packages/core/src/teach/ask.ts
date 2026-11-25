/**
 * 教學卡「問 AI」的回答格式與提示組裝(ADR-086,T68)。純函式:不碰檔案、不 import node: 模組。
 * 模板檔 `prompts/teach/ask.md` 由 session/teach-ask.ts 讀進來再傳給這裡(改了要跑 golden run,ADR-032)。
 *
 * 回答格式是模組內部的軟約定(不是契約):
 *   { answer: 非空字串, suggestion: 'continue' | 'deepen' | 'back', followups: 0–3 個非空字串 }
 * 看不懂(不是整段 JSON 物件、缺欄位、多欄位、值不合法)整個當失敗:不猜、不截、不修。
 * 長度不在這裡檢查(提示叫 AI 寫 200 字、追問 30 字內,程式不卡)。
 */
import { z } from 'zod';

export const ASK_SUGGESTIONS = ['continue', 'deepen', 'back'] as const;
export type AskSuggestion = (typeof ASK_SUGGESTIONS)[number];

/** 提示最多帶幾輪(含這一輪)。也是 token 上限的一部分(顧問定 N = 4)。 */
export const MAX_ASK_ROUNDS = 4;

const NonBlank = z.string().refine((s) => s.trim().length > 0, { message: '不能是空的' });

export const AskAnswerSchema = z.strictObject({
  answer: NonBlank,
  suggestion: z.enum(ASK_SUGGESTIONS),
  followups: z.array(NonBlank).max(3),
});
export type AskAnswer = z.infer<typeof AskAnswerSchema>;

export type ParsedAsk = { ok: true; value: AskAnswer } | { ok: false };

/** 模型回的原文 → 回答。只認「整段(前後空白除外)就是一個合法的 JSON 物件」。不丟例外。 */
export function parseAskAnswer(text: string): ParsedAsk {
  try {
    const json: unknown = JSON.parse(text.trim());
    const parsed = AskAnswerSchema.safeParse(json);
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export interface AskRound {
  question: string;
  answer: string;
}

export interface AskCardView {
  category: string;
  title: string;
  level: number;
  body: string;
  examples: readonly string[];
  /** 這張卡還沒學的先備標題(畫面先備提示列的那幾張)。 */
  unlearnedPrereqTitles: readonly string[];
  /** 已經是最深一層:深入沒有下一層。 */
  atFloor: boolean;
}

/** 只留最近的幾輪,讓「這一輪 + 前面的」不超過 MAX_ASK_ROUNDS。 */
export function recentRounds(history: readonly AskRound[]): AskRound[] {
  return history.slice(Math.max(0, history.length - (MAX_ASK_ROUNDS - 1)));
}

/**
 * 組提示:模板 + 目前那張卡 + 前幾輪問答 + 這一輪的問題。
 * 只含傳進來的這一張卡;沒有任何路徑、卡 id。
 */
export function buildAskPrompt(args: { template: string; card: AskCardView; history: readonly AskRound[]; question: string }): string {
  const { template, card, history, question } = args;
  const header = [
    `category: ${card.category}`,
    `title: ${card.title}`,
    `level: ${card.level}`,
    `deepest level: ${card.atFloor ? 'yes' : 'no'}`,
    `unlearned prereqs: ${card.unlearnedPrereqTitles.length === 0 ? '(none)' : card.unlearnedPrereqTitles.join('; ')}`,
  ];
  const lines: string[] = [template.endsWith('\n') ? template.slice(0, -1) : template, '---', ...header, '---', card.body];
  for (const example of card.examples) lines.push('', `example: ${example}`);
  const rounds = recentRounds(history);
  if (rounds.length > 0) {
    lines.push('---', 'earlier discussion on this card:');
    rounds.forEach((round, i) => {
      lines.push(`earlier question ${i + 1}: ${round.question}`, `earlier answer ${i + 1}: ${round.answer}`);
    });
  }
  lines.push('---', `question: ${question}`, '');
  return lines.join('\n');
}
