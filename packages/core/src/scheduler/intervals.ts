/** 契約 §4 間隔表與題型對應表的權威實作。硬約定,不要自己重新發明數字。 */
import type { QuestionType, Stage } from './types.js';

type ScheduledStage = 1 | 2 | 3 | 4 | 5;

const INTERVAL_DAYS: Record<ScheduledStage, number> = {
  1: 1,
  2: 7,
  3: 30,
  4: 90,
  5: 180,
};

const QUESTION_TYPES: Record<ScheduledStage, QuestionType[]> = {
  1: ['fill'],
  2: ['fill', 'apply'],
  3: ['apply'],
  4: ['apply'],
  5: ['apply'],
};

function assertScheduled(stage: Stage): asserts stage is ScheduledStage {
  if (stage < 1 || stage > 5) {
    throw new Error(`stage ${stage} 沒有固定間隔或題型,只有 1..5 在複習週期內`);
  }
}

export function intervalDaysForStage(stage: Stage): number {
  assertScheduled(stage);
  return INTERVAL_DAYS[stage];
}

export function questionTypesForStage(stage: Stage): QuestionType[] {
  assertScheduled(stage);
  return QUESTION_TYPES[stage];
}
