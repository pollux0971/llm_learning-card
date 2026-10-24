/**
 * 07-teach-card / phase-4 的步驟定義(工單 T46 驗收 1「場景 3」)。測試 agent 寫;開發 worker 不改。
 * 場景原文在 features/07-teach-card/phase-4.feature(不改)。phase-4 只有「Image paths resolve against the assets directory」一條不是 @manual;
 * 其餘(折疊、放大、找不到、縮放、長內容、視窗大小)由前端量、有 vitest 渲染測試。
 *
 * 接真的零件:桌面殼的 `createLearningFs({ os: 'linux', invoke: <假的> }).assetUrl`(`apps/desktop/src/webview/learning-fs.ts`)當 `assetUrl`,
 * 交給真的 `renderMarkdown(body, { cardDir, assetUrl })`。假的 `invoke` 一呼叫就丟錯並記下:`assetUrl` 是同步的、不經 command,所以要 0 次。
 * 斷言看輸出:`<img src>` 是 `lc://localhost/assets/<檔名>`(中文檔名逐段 encodeURIComponent)、`assetUrl` 收到 `assets/<檔名>`(沒編碼過)。
 *
 * 共用步驟「it is rendered」(teach-card.steps.ts)在 phase-4 的 world 裡改派到這裡(`phase4Active` / `phase4Render`)。
 * `renderMarkdown` 的選項名與 image-path.ts 的名字見 packages/ui-shared/src/image-path.test.ts 檔頭。
 * 模組用算出來的 file URL 動態 import:基底上是「功能還沒有」而紅,不是 tsc 錯。
 */
import { Given, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LearningWorld } from './_world.js';
import { createLearningFs } from '../../apps/desktop/src/webview/learning-fs.js';

const ROOT = join(import.meta.dirname, '../..');
const FENCE = pathToFileURL(join(ROOT, 'packages/ui-shared/src/example-fence.ts')).href;

interface RenderOptions {
  cardDir: string;
  assetUrl: (relPath: string) => string;
}
interface FenceModule {
  renderMarkdown(source: string, options?: RenderOptions): string;
}

const CARD_PATH = 'cards/security/sec-0001.md';
const CARD_DIR = 'cards/security';

interface Phase4State {
  assetCalls: string[];
  invokeCalls: string[];
  html: string | undefined;
}
const states = new WeakMap<LearningWorld, Phase4State>();

export function phase4Active(world: LearningWorld): boolean {
  return states.has(world);
}

function stripFrontmatter(text: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
  return m ? text.slice(m[0].length) : text;
}

/** 共用的 When「it is rendered」在 phase-4 的 world 裡走這裡 */
export async function phase4Render(world: LearningWorld): Promise<void> {
  const state = states.get(world);
  assert.ok(state, 'phase-4 的 Given 要先跑');
  assert.ok(world.cardText, 'world.cardText 還沒設定');
  const mod = (await import(/* @vite-ignore */ FENCE)) as FenceModule;
  const fs = createLearningFs({
    os: 'linux',
    invoke: async (cmd) => {
      state.invokeCalls.push(cmd);
      throw new Error(`assetUrl 不該經過 command:${cmd}`);
    },
  });
  const assetUrl = (relPath: string): string => {
    state.assetCalls.push(relPath);
    return fs.assetUrl(relPath);
  };
  state.html = mod.renderMarkdown(stripFrontmatter(world.cardText), { cardDir: CARD_DIR, assetUrl });
  world.resultText = state.html;
}

Given('an example contains a relative image path', function (this: LearningWorld) {
  states.set(this, { assetCalls: [], invokeCalls: [], html: undefined });
  this.cardText = [
    '---',
    'id: sec-0001',
    'category: security',
    'title: 圖片路徑',
    'level: 0',
    'source: raw',
    'created: 2026-09-01',
    '---',
    '卡片的內文。',
    '',
    '```example',
    '例子:',
    '',
    '![架構圖](../../assets/diagram.png)',
    '',
    '![中文檔名](../../assets/同源.png)',
    '```',
    '',
  ].join('\n');
  void CARD_PATH;
});

Then('the image source resolves to the assets directory through the desktop boundary', function (this: LearningWorld) {
  const state = states.get(this);
  assert.ok(state?.html, '要先渲染');
  const srcs = [...state.html.matchAll(/<img\b[^>]*?\bsrc="([^"]*)"/g)].map((m) => m[1]!);
  assert.deepEqual(srcs, ['lc://localhost/assets/diagram.png', `lc://localhost/assets/${encodeURIComponent('同源')}.png`], `img 的 src(桌面殼 assetUrl 的回傳值);輸出:${state.html}`);
  assert.deepEqual(state.assetCalls, ['assets/diagram.png', 'assets/同源.png'], 'assetUrl 收到的是解析後的 learning 相對路徑(沒編碼過、也沒帶卡片的目錄)');
  assert.deepEqual(state.invokeCalls, [], 'assetUrl 是同步的,不經 Tauri command:invoke 0 次');
  assert.ok(!state.html.includes('../../assets'), '卡片原文的相對路徑不能留在 src 裡');
});
