<script lang="ts">
  import cardRaw from '../../../../../contracts/fixtures/cards/valid-basic.md?raw';
  import '../hud.css';
  import HpBar from '../HpBar.svelte';
  import HudButton from '../HudButton.svelte';
  import HudField from '../HudField.svelte';
  import HudPanel from '../HudPanel.svelte';
  import { FRAMELESS_CLASS, SOLID_CLASS } from '../layout.js';
  import { createWindowControls } from '../window-controls.js';

  const controls = createWindowControls();

  function cardFromFixture(raw: string): { title: string; body: string } {
    const matched = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
    if (!matched) return { title: 'HUD', body: raw };
    const front = matched[1] ?? '';
    const title = /^title:\s*(.+)\s*$/m.exec(front)?.[1]?.trim() ?? 'HUD';
    return { title, body: (matched[2] ?? '').trim() };
  }

  const card = cardFromFixture(cardRaw);
  let frameless = $state(false);
  let solid = $state(false);

  function onFramelessChange(event: Event): void {
    const on = (event.currentTarget as HTMLInputElement).checked;
    frameless = on;
    document.documentElement.classList.toggle(FRAMELESS_CLASS, on);
  }

  function onSolidChange(event: Event): void {
    const on = (event.currentTarget as HTMLInputElement).checked;
    solid = on;
    document.documentElement.classList.toggle(SOLID_CLASS, on);
  }
</script>

<main class="page">
  <div class="head" data-gallery="head">
    <h1 class="hud-num">HUD</h1>
    <p class="lead">亮色半透明切角框、HUD 按鈕、HP 條。無框與實心底切換根元素的 class;深色背景只影響這一頁。</p>
    <div class="switches">
      <label>
        <input type="checkbox" onchange={onFramelessChange} />
        無框(標題列與縮放把手;瀏覽器裡沒有縮小與關閉鈕)
      </label>
      <label>
        <input type="checkbox" onchange={onSolidChange} />
        實心底(切角外面填實色)
      </label>
      <label>
        <input type="checkbox" data-gallery="dark-backdrop" />
        深色背景(看半透明)
      </label>
    </div>
  </div>
  <HudPanel title={card.title} {frameless} {solid} {controls}>
    <p class="kicker">教學卡 · fixture</p>
    <p class="copy">{card.body}</p>
    <div class="actions">
      <HudButton>上一張</HudButton>
      <HudButton>記住了</HudButton>
      <HudButton>下一張</HudButton>
    </div>
    <div class="meters">
      <div>
        <p class="hud-num">0 / 3</p>
        <HpBar done={0} total={3} />
      </div>
      <div>
        <p class="hud-num">2 / 3</p>
        <HpBar done={2} total={3} />
      </div>
      <div>
        <p class="hud-num">3 / 3</p>
        <HpBar done={3} total={3} />
      </div>
    </div>
    <div class="fields">
      <div>
        <HudField>
          <input type="text" />
        </HudField>
      </div>
      <div>
        <HudField>
          <textarea rows="2"></textarea>
        </HudField>
      </div>
    </div>
  </HudPanel>
</main>

<style>
  /* 格線是展示頁假裝桌面用的,不放進共用的 hud.css。 */
  :global(html) {
    background-color: var(--hud-page);
    background-image:
      linear-gradient(var(--hud-page-line) 1px, transparent 1px),
      linear-gradient(90deg, var(--hud-page-line) 1px, transparent 1px);
    background-size: 28px 28px;
  }

  /* 深色底加粗格線。橫線每條垂直取樣線都會穿過;直線做成斷線,壓在直線上也不會整條發亮。 */
  :global(html:has([data-gallery="dark-backdrop"]:checked)) {
    isolation: isolate;
    background-color: var(--hud-text);
    background-image: linear-gradient(var(--hud-solid) 4px, transparent 4px);
    background-size: 28px 28px;
  }

  :global(html:has([data-gallery="dark-backdrop"]:checked)::before) {
    content: "";
    position: fixed;
    z-index: -1;
    inset: 0;
    pointer-events: none;
    background-image: linear-gradient(90deg, var(--hud-solid) 4px, transparent 4px);
    background-size: 28px 28px;
    mask-image: linear-gradient(transparent 0 6px, black 6px 22px, transparent 22px);
    mask-size: 28px 28px;
  }

  .page {
    max-width: 42rem;
    margin: 0 auto;
    padding: 0.4rem 1rem 0.75rem;
  }
  .head {
    background: var(--hud-solid);
    color: var(--hud-text);
    padding: 0.3rem 0.5rem 0.4rem;
    margin: 0 0 0.4rem;
  }
  .head .hud-num {
    margin: 0;
  }
  .lead {
    margin: 0.15rem 0 0;
    line-height: 1.35;
  }
  .switches {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 1rem;
    margin: 0.3rem 0 0;
  }
  .kicker {
    margin: 0;
    font-size: 0.85rem;
  }
  .copy {
    white-space: pre-wrap;
    line-height: 1.55;
    margin: 0.6rem 0 0;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-top: 0.55rem;
  }
  .meters {
    display: flex;
    gap: 0.6rem;
    margin-top: 0.35rem;
  }
  .meters > div {
    flex: 1 1 0;
    min-width: 0;
  }
  .meters .hud-num {
    margin: 0 0 0.1rem;
  }
  .fields {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.35rem;
  }
  .fields > div {
    flex: 1 1 0;
    min-width: 0;
  }
</style>
