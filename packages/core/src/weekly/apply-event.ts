import type { ApplyOutcome, Weekly, WeeklyEvent, WeeklyRollover } from './types.js';
import { isTargetMet } from './target.js';

/**
 * 套用一個事件到週目標狀態。純函式:不修改輸入,永遠回傳新物件。
 *
 * 只有「通過第一個 checkpoint(D1)」且該卡本週還沒被計入過,才會讓 passed_d1 +1
 * 並把卡加進 counted。其他 checkpoint 的通過不計。
 *
 * currentWeek 與 weekly.week 不同時,先做一次週歸零(無論落後幾週,只記一筆 rollover,
 * 直接跳到 currentWeek),歸零後才套用事件。
 */
export function applyEvent(weekly: Weekly, event: WeeklyEvent, currentWeek: string): ApplyOutcome {
  let state = weekly;
  let rollover: WeeklyRollover | undefined;

  if (weekly.week !== currentWeek) {
    rollover = {
      week: weekly.week,
      target: weekly.target,
      learned: weekly.learned,
      passed_d1: weekly.passed_d1,
      target_met: isTargetMet(weekly.passed_d1, weekly.target),
    };
    state = { week: currentWeek, target: weekly.target, learned: 0, passed_d1: 0, counted: [] };
  }

  state = applyDomainEvent(state, event);

  return rollover ? { weekly: state, rollover } : { weekly: state };
}

function applyDomainEvent(weekly: Weekly, event: WeeklyEvent): Weekly {
  if (event.type === 'learned') {
    return { ...weekly, counted: [...weekly.counted], learned: weekly.learned + 1 };
  }
  if (event.checkpoint !== 1 || weekly.counted.includes(event.card)) {
    return { ...weekly, counted: [...weekly.counted] };
  }
  return { ...weekly, passed_d1: weekly.passed_d1 + 1, counted: [...weekly.counted, event.card] };
}
