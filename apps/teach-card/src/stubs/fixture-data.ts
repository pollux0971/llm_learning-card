/**
 * phase-1 的「rich fixture set」:直接用 Vite 的 ?raw import 讀 contracts/fixtures/ 底下
 * 既有的卡片樣本(vite.config.ts 已經開 fs.allow 到 repo 根,就是為了這個),組成一個
 * MemoryFs。沒有另外手抄一份卡片內容,整合時只要換 MemoryFs 的建構方式。
 */
import cardSec0001 from '../../../../contracts/fixtures/learning-minimal/cards/security/sec-0001.md?raw';
import cardSec0002 from '../../../../contracts/fixtures/learning-minimal/cards/security/sec-0002.md?raw';
import cardSec0003 from '../../../../contracts/fixtures/learning-minimal/cards/security/sec-0003.md?raw';
import cardSec0020 from '../../../../contracts/fixtures/cards/valid-no-example.md?raw';
import cardSec0021 from '../../../../contracts/fixtures/cards/valid-three-examples.md?raw';
import cardSec0022 from '../../../../contracts/fixtures/cards/valid-level1-with-parent.md?raw';
import cardSec0023 from '../../../../contracts/fixtures/cards/valid-example-with-nested-content.md?raw';
import { MemoryFs } from './memory-fs.js';
import { fakeOrder } from './order.js';

export const CATEGORY = 'security';

const RAW_CARDS: Record<string, string> = {
  'sec-0001': cardSec0001,
  'sec-0002': cardSec0002,
  'sec-0003': cardSec0003,
  'sec-0020': cardSec0020,
  'sec-0021': cardSec0021,
  'sec-0022': cardSec0022,
  'sec-0023': cardSec0023,
};

export const ORDER = fakeOrder(Object.keys(RAW_CARDS));

export function cardPath(id: string): string {
  return `cards/${CATEGORY}/${id}.md`;
}

export function createFixtureFs(): MemoryFs {
  const files: Record<string, string> = {};
  for (const [id, raw] of Object.entries(RAW_CARDS)) {
    files[cardPath(id)] = raw;
  }
  return new MemoryFs(files);
}
