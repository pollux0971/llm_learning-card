<script lang="ts">
  import { renderMarkdown } from '@learning/ui-shared';
  import '@learning/ui-shared/hud/hud.css';
  import HudButton from '@learning/ui-shared/hud/HudButton.svelte';
  import HudPanel from '@learning/ui-shared/hud/HudPanel.svelte';
  import { createWindowControls } from '@learning/ui-shared/hud/window-controls';
  import { parseCard, type CardFrontmatter } from './lib/card.js';
  import { createTeachSession, type TeachSessionDeps, type TeachView } from './teach-session.js';

  let { deps }: { deps: TeachSessionDeps } = $props();

  const EXAMPLE_OPEN_KEY = 'lc-teach-example-open';
  const CONTENT_ZOOM_KEY = 'lc-teach-zoom';
  const CONTENT_ZOOM_LEVELS = [0.8, 0.9, 1, 1.1, 1.25, 1.5] as const;

  function readContentZoom(): number {
    const raw = deps.storage.getItem(CONTENT_ZOOM_KEY);
    if (raw === null) return 1;
    const n = Number(raw);
    return (CONTENT_ZOOM_LEVELS as readonly number[]).includes(n) ? n : 1;
  }

  const session = createTeachSession(deps);
  const controls = createWindowControls();
  let view = $state<TeachView>(session.view());
  let bodyEl = $state<HTMLElement | undefined>();
  let zoom = $state<{ src: string; w: number; h: number; nw: number; nh: number } | null>(null);
  let contentZoom = $state(readContentZoom());
  let zoomEl = $state<HTMLElement | undefined>();
  let cover = $state({ left: 0, top: 0, width: 0, height: 0 });
  /**
   * 上一張卡的 html。鍵是 path + cardText,只記一份。
   * 不是 $state:寫進 $derived 裡不能再變成依賴,否則每次 pull 都會為了記下來而重跑。
   */
  let cardMemo: { path: string; cardText: string; frontmatter: CardFrontmatter; html: string } | null = null;

  function pull(): void {
    view = session.view();
  }

  $effect(() => {
    return deps.client.onWait(() => {
      pull();
    });
  });

  $effect(() => {
    return session.onChange(() => {
      pull();
    });
  });

  function cardDirOf(path: string): string {
    const slash = path.lastIndexOf('/');
    return slash < 0 ? '' : path.slice(0, slash);
  }

  function parsed(): { frontmatter: CardFrontmatter; html: string } | null {
    if (!view.cardText) return null;
    const path = view.card?.path ?? '';
    const cardText = view.cardText;
    // 鍵沒變就回同一份字串:不呼叫 renderMarkdown、不讀 storage。{@html} 比的是字串相等,節點才不會換。
    if (cardMemo && cardMemo.path === path && cardMemo.cardText === cardText) {
      return { frontmatter: cardMemo.frontmatter, html: cardMemo.html };
    }
    try {
      const card = parseCard(cardText);
      // 折疊狀態只在換卡時讀。不要把「開或收」放進 $state,也不要只把這行包 untrack:view 一換 parsed 還是會重跑,讀到的是新的 storage。
      const html = renderMarkdown(card.bodyMarkdown, {
        cardDir: cardDirOf(path),
        assetUrl: (relPath) => deps.fs.assetUrl(relPath),
        examplesOpen: deps.storage.getItem(EXAMPLE_OPEN_KEY) !== '0',
      });
      cardMemo = { path, cardText, frontmatter: card.frontmatter, html };
      return { frontmatter: card.frontmatter, html };
    } catch {
      return null;
    }
  }

  const shown = $derived(parsed());

  // 離開卡片畫面({@html} 卸下)再回來,鍵可能一樣,但元件是新掛上的,不能拿舊 html。
  // $derived 是惰性的:類別清單時 shown 沒被讀,parsed() 不會跑,所以不能在裡面清。
  $effect(() => {
    if (view.state !== 'card') cardMemo = null;
  });
  const finished = $derived(view.state !== 'card' || !view.canNext || view.controlsDisabled);

  function handleNext(): void {
    if (finished) return;
    void act(() => session.next());
  }

  /**
   * 直角引號裡的短詞不折斷。只包比一行短的(≤14 字,含兩個括號);
   * 長詞不包,照常折行,避免橫向凸出。對每一句都切,不寫死某一句。
   */
  const QUOTE_KEEP_MAX = 14;

  function quoteParts(text: string | undefined): { text: string; keep: boolean }[] {
    const parts: { text: string; keep: boolean }[] = [];
    if (!text) return parts;
    const re = /「[^」]*」/g;
    let last = 0;
    for (const match of text.matchAll(re)) {
      const start = match.index ?? 0;
      if (start > last) parts.push({ text: text.slice(last, start), keep: false });
      const segment = match[0];
      parts.push({ text: segment, keep: segment.length <= QUOTE_KEEP_MAX });
      last = start + segment.length;
    }
    if (last < text.length) parts.push({ text: text.slice(last), keep: false });
    return parts;
  }

  async function act(run: () => Promise<void>): Promise<void> {
    await run();
    pull();
  }

  function rememberExampleOpen(open: boolean): void {
    deps.storage.setItem(EXAMPLE_OPEN_KEY, open ? '1' : '0');
  }

  function onExampleToggle(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLDetailsElement)) return;
    if (!/(?:^|\s)lc-example(?:\s|$)/.test(target.className)) return;
    rememberExampleOpen(target.open);
  }

  function onImageError(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLImageElement)) return;
    const path = target.getAttribute('data-asset-path');
    if (!path) return;
    const note = document.createElement('span');
    note.className = 'lc-missing';
    note.textContent = `找不到圖片:${path}`;
    target.replaceWith(note);
  }

  function fittedSize(nw: number, nh: number): { w: number; h: number } {
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    if (nw <= 0 || nh <= 0 || winW <= 0 || winH <= 0) return { w: 0, h: 0 };
    const scale = Math.min(winW / nw, winH / nh);
    return { w: nw * scale, h: nh * scale };
  }

  function onBodyClick(event: MouseEvent): void {
    if (zoom) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const img = target.closest('img');
    if (!(img instanceof HTMLImageElement)) return;
    if (!img.closest('.lc-example')) return;
    if (img.naturalWidth <= 0 || img.naturalHeight <= 0) return;
    const src = img.currentSrc || img.src;
    if (!src) return;
    event.preventDefault();
    event.stopPropagation();
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const size = fittedSize(nw, nh);
    cover = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    zoom = { src, w: size.w, h: size.h, nw, nh };
  }

  function swallow(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  function closeZoom(event: MouseEvent): void {
    swallow(event);
    zoom = null;
  }

  $effect(() => {
    const el = bodyEl;
    if (!el) return;
    const onError = (event: Event) => onImageError(event);
    const onToggle = (event: Event) => onExampleToggle(event);
    const onClick = (event: MouseEvent) => onBodyClick(event);
    el.addEventListener('error', onError, true);
    el.addEventListener('toggle', onToggle, true);
    el.addEventListener('click', onClick);
    return () => {
      el.removeEventListener('error', onError, true);
      el.removeEventListener('toggle', onToggle, true);
      el.removeEventListener('click', onClick);
    };
  });

  $effect(() => {
    if (!zoom) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      zoom = null;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /**
   * 只縮卡片內容。級距記在 deps.storage,換卡、重新載入都照舊。
   * 只從這條按鍵路改級距;不准走 webview 縮放。
   */
  function onContentZoomKey(event: KeyboardEvent): void {
    if (event.altKey || !(event.ctrlKey || event.metaKey)) return;
    let dir: 'in' | 'out' | 'reset' | null = null;
    if (event.code === 'Equal' || event.code === 'NumpadAdd') dir = 'in';
    else if ((event.code === 'Minus' || event.code === 'NumpadSubtract') && !event.shiftKey) dir = 'out';
    else if ((event.code === 'Digit0' || event.code === 'Numpad0') && !event.shiftKey) dir = 'reset';
    if (!dir) return;
    event.preventDefault();
    const i = CONTENT_ZOOM_LEVELS.indexOf(contentZoom as (typeof CONTENT_ZOOM_LEVELS)[number]);
    const at = i < 0 ? CONTENT_ZOOM_LEVELS.indexOf(1) : i;
    const next =
      dir === 'reset' ? 1 : dir === 'in' ? CONTENT_ZOOM_LEVELS[Math.min(at + 1, CONTENT_ZOOM_LEVELS.length - 1)]! : CONTENT_ZOOM_LEVELS[Math.max(at - 1, 0)]!;
    if (next === contentZoom) return;
    contentZoom = next;
    deps.storage.setItem(CONTENT_ZOOM_KEY, String(next));
  }

  $effect(() => {
    window.addEventListener('keydown', onContentZoomKey);
    return () => window.removeEventListener('keydown', onContentZoomKey);
  });

  $effect(() => {
    const el = zoomEl;
    if (!zoom || !el) return;
    const place = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const rect = el.getBoundingClientRect();
      const left = cover.left - rect.left;
      const top = cover.top - rect.top;
      if (left !== cover.left || top !== cover.top || width !== cover.width || height !== cover.height) {
        cover = { left, top, width, height };
      }
      // 不只對位置:用打開時那張圖的 naturalWidth / naturalHeight,照目前視窗重算寬高(等比例、裝得下的最大)。
      const current = zoom;
      if (!current) return;
      const size = fittedSize(current.nw, current.nh);
      if (current.w === size.w && current.h === size.h) return;
      zoom = { src: current.src, w: size.w, h: size.h, nw: current.nw, nh: current.nh };
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  });

  void act(() => session.open());
</script>

<HudPanel title="教學卡" {controls} fill>
  {#if view.busyNotice}
    <p class="notice">{view.busyNotice}</p>
  {/if}

  {#if view.state === 'loading'}
    <p>載入中…</p>
  {:else if view.state === 'error'}
    <p class="error">{view.message}</p>
    {#if view.canRetry}
      <HudButton onclick={() => void act(() => session.retry())} disabled={view.controlsDisabled}>再試一次</HudButton>
    {/if}
  {:else if view.state === 'categories'}
    <div class="list">
      {#each view.categories as row (row.id)}
        <HudButton onclick={() => void act(() => session.chooseCategory(row.id))} disabled={view.controlsDisabled}>
          {row.label}
        </HudButton>
      {/each}
      <HudButton onclick={() => { session.cancelCategories(); pull(); }} disabled={view.controlsDisabled}>取消</HudButton>
    </div>
  {:else if view.state === 'finished'}
    <p class="finished">{view.message}</p>
    <div class="controls">
      <HudButton onclick={() => { session.openCategories(); pull(); }} disabled={view.controlsDisabled}>換類別</HudButton>
    </div>
  {:else if view.state === 'card' && shown}
    <div class="lc-scale" style:zoom={contentZoom}>
      <header class="markers">
        <span class="category">{session.categoryNameOf(shown.frontmatter.category)}</span>
        <span class="source">{shown.frontmatter.source === 'raw' ? '原始' : '生成'}</span>
        <span class="level">Level {shown.frontmatter.level}</span>
        {#if view.from}
          <span class="from">來自:{view.from.title}</span>
        {/if}
        {#if shown.frontmatter.provisional}
          <span class="badge">待審核</span>
        {/if}
      </header>
      {#if view.prereqs.length > 0}
        <p class="prereqs">
          <span class="prereq-label">先備還沒學:</span>
          {#each view.prereqs as item, index (item.id)}
            <HudButton onclick={() => void act(() => session.followPrereq(index))} disabled={view.controlsDisabled}>
              {item.title}
            </HudButton>
          {/each}
        </p>
      {/if}
      <h2>{shown.frontmatter.title}</h2>
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      <div class="body" bind:this={bodyEl}>{@html shown.html}</div>
    </div>
    <!-- 放大層不能放進黏底區塊,否則會縮成那一塊的大小;也不能放進縮放層,否則跟著內容縮。 -->
    {#if zoom}
      <div
        class="lc-zoom"
        bind:this={zoomEl}
        style:left="{cover.left}px"
        style:top="{cover.top}px"
        style:width="{cover.width}px"
        style:height="{cover.height}px"
        onmousedown={swallow}
        onmouseup={swallow}
        onclick={closeZoom}
      >
        <img src={zoom.src} alt="" style:width="{zoom.w}px" style:height="{zoom.h}px" />
      </div>
    {/if}
    <div class="dock">
      <div class="controls">
        {#if view.canBack}
          <HudButton onclick={() => void act(() => session.back())} disabled={view.controlsDisabled}>回上一層</HudButton>
        {/if}
        <HudButton onclick={handleNext} disabled={finished}>下一個</HudButton>
        <HudButton onclick={() => { session.openCategories(); pull(); }} disabled={view.controlsDisabled}>換類別</HudButton>
        <HudButton onclick={() => void act(() => session.deepen())} disabled={!view.canDeepen}>深入這個</HudButton>
      </div>
      <!-- 字樣在按鈕列下面。這塊永遠在,高度固定,出現、收掉、換種類都不推動上面的按鈕。 -->
      <div class="status-slot">
        {#if view.generatingNotice}
          <p class="generating">{#each quoteParts(view.generatingNotice) as part, index (index)}{#if part.keep}<span class="quote-keep">{part.text}</span>{:else}{part.text}{/if}{/each} <HudButton onclick={() => void act(() => session.cancel())}>取消</HudButton></p>
        {/if}
        {#if view.deepenError}
          <p class="deepen-error">{#each quoteParts(view.deepenError) as part, index (index)}{#if part.keep}<span class="quote-keep">{part.text}</span>{:else}{part.text}{/if}{/each}</p>
        {/if}
      </div>
    </div>
  {/if}
</HudPanel>

<style>
  .markers {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: var(--hud-text);
  }
  .badge {
    color: var(--hud-text);
    background: var(--hud-accent-wash);
    padding: 0 0.4rem;
  }
  h2 {
    margin: 0.6rem 0 0.35rem;
    font-size: 1.15rem;
    font-weight: 600;
  }
  .body {
    overflow-wrap: anywhere;
  }
  .controls,
  .prereqs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  .list {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  .list :global([data-hud='button']) {
    width: fit-content;
    max-width: 100%;
  }
  .list :global(.hud-button-label) {
    justify-content: flex-start;
    text-align: left;
  }
  .prereqs {
    margin: 0.4rem 0 0;
  }
  .prereq-label {
    display: inline-flex;
    align-items: center;
    line-height: 1;
  }
  .notice,
  .finished,
  .error {
    margin: 0.4rem 0;
  }
  /* 系統狀態跟內文分開:小一號、上方 1px 分隔線。字色照舊,只用 var(--hud-*)。
     分隔線只寫在這兩個 selector 自己身上,不搬到外層。 */
  .generating,
  .deepen-error {
    margin: 0.75rem 0 0;
    padding-top: 0.4rem;
    border-top: 1px solid var(--hud-line);
    font-size: 0.85rem;
    color: var(--hud-text);
  }
  /* 按鈕列下面先留的位置。flow-root 讓第一個 p 的 margin-top 留在裡面,不外溢 0.75rem。
     高度用 360 寬量到的最高金鑰句:missing/ANTHROPIC_API_KEY 邊框盒 67.4px(3 行),
     加上這條 margin-top 0.75rem,再留 2px 給次像素。不要估成兩行。 */
  .status-slot {
    display: flow-root;
    min-height: calc(67.4px + 0.75rem + 2px);
  }
  .quote-keep {
    white-space: nowrap;
  }
  :global(.lc-example) {
    background: var(--hud-solid);
    border-left: 1px solid var(--hud-line);
    padding: 0.5rem 1rem;
    margin: 1rem 0;
  }
  :global(.lc-example summary) {
    cursor: pointer;
  }
  .body :global(img) {
    max-width: 100%;
    height: auto;
  }
  /* 執行時 createElement 的節點,scoped 選不到;:global 才套得到,也不留死樣式。 */
  :global(.lc-missing) {
    font-size: 0.85rem;
    color: var(--hud-text);
  }
  /* 只縮卡片內容。zoom 會重排;不用 transform。 */
  .lc-scale {
    min-width: 0;
  }
  /* 按鈕列與狀態字樣黏在 .hud-body 看得到的底部。內容比視窗短時留在內容後面。
     底色蓋住捲過去的內文,不畫線。放大層在這塊外面。 */
  .dock {
    position: sticky;
    bottom: 0;
    z-index: 1;
    display: flow-root;
    background: var(--hud-panel);
  }
  /* .hud-body 預設 padding-bottom 1rem。sticky bottom:0 停在內容區邊緣;
     捲到底時 bottom 不作用,那 16px 會露在按鈕下面(測試 c 要 ≤ 2)。
     不能寫 0:T35 要求計算值 > 0,而且提示程式在卡片畫出來前就記 base,
     0 會讓「base + 提示高度」對不上。1px 兩邊都過:黏底距離 ≤ 2,提示仍停在按鈕下面。
     scroll-padding-bottom 讓 scrollIntoView 把標題捲到黏底區塊上面,才點得到。 */
  :global([data-hud="panel"].hud-fill .hud-body) {
    padding-bottom: 1px;
    scroll-padding-bottom: 200px;
  }
  .lc-zoom {
    position: fixed;
    z-index: 40;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0;
    padding: 0;
    background: var(--hud-solid);
  }
  .lc-zoom img {
    flex: none;
    max-width: none;
    max-height: none;
  }
</style>
