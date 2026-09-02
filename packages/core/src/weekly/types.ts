/**
 * 契約 §9 的 Weekly 與相關型別。packages/contracts 目前是空殼(01-data-layer 尚未填),
 * 所以先在這裡自己定義,與 contracts/types.md 保持一致。
 */

export type CardId = string;
export type IsoDate = string;
export type IsoWeek = string;

export interface Weekly {
  week: IsoWeek;
  target: number;
  learned: number;
  passed_d1: number;
  counted: CardId[];
}

export type WeeklyEvent =
  | { type: 'learned'; card: CardId }
  | { type: 'checkpoint-passed'; card: CardId; checkpoint: number };

/** 一次週歸零留下的紀錄,呼叫端可以把它轉成 §10 的 LogEvent(type: 'week_rolled')寫進 log.jsonl。 */
export interface WeeklyRollover {
  week: IsoWeek;
  target: number;
  learned: number;
  passed_d1: number;
  target_met: boolean;
}

export interface ApplyOutcome {
  weekly: Weekly;
  rollover?: WeeklyRollover;
}
