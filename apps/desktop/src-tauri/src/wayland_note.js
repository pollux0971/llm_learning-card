// Wayland 一次性提示。Rust 只在 Wayland 把這份檔接在 window_mode 的 init script 後面
// (initialization_script,document 還沒有 body)。等頁面載入完才畫,按掉之後寫 localStorage,之後不再出現。
// 樣式只走 CSSOM 與 HUD 掛鉤,顏色只用 var(--hud-*)。不碰網路、不碰 invoke。
// T35:提示固定在底部(左右各 8、離底 8),不往上挪、不改成窄條。提示在的時候,主捲動區
// [data-hud="panel"].hud-fill .hud-body 的 padding-bottom 變成「設之前的計算值 + 提示現在的高度」。
// 提示高度變了(變窄換行、字型晚到)就重算。按掉之後把 inline 值還原成設之前的那個,不寫死 16px。
(function () {
  var KEY = 'lc-wayland-note-dismissed';
  var TEXT = 'Wayland 底下無法強制視窗置頂,請在桌面環境設定「永遠在最上層」。';
  var NOTE_ID = 'lc-wayland-note';
  var SCROLL = '[data-hud="panel"].hud-fill .hud-body';
  var watch = null;
  var sizeWatch = null;
  var reserved = null;
  var closed = false;

  function dismissed() {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch (err) {
      return false;
    }
  }

  function paint(el, props) {
    var name;
    for (name in props) {
      if (Object.prototype.hasOwnProperty.call(props, name)) el.style.setProperty(name, props[name]);
    }
  }

  function scrollArea() {
    return document.querySelector(SCROLL);
  }

  // 還原設留白之前的 inline 值。通常是空的:拿掉屬性,計算值回到樣式表,不是寫死 16px。
  function release() {
    if (!reserved) return;
    var el = reserved.el;
    var inline = reserved.inline;
    reserved = null;
    if (!el) return;
    if (inline) el.style.setProperty('padding-bottom', inline);
    else el.style.removeProperty('padding-bottom');
  }

  // 同一個元素只記一次「設之前」的計算值,避免把已經加上的留白再加一次。找不到捲動區就不加。
  function reserve(note) {
    if (closed || !note || !note.isConnected) return;
    var body = scrollArea();
    if (!body) return;
    if (!reserved || reserved.el !== body) {
      release();
      var raw = parseFloat(window.getComputedStyle(body).paddingBottom);
      reserved = {
        el: body,
        inline: body.style.getPropertyValue('padding-bottom'),
        base: raw === raw ? raw : 0,
      };
    }
    var h = note.getBoundingClientRect().height;
    body.style.setProperty('padding-bottom', (reserved.base + h) + 'px');
  }

  // 固定在底部。捲動、換畫面、縮放都不改這個位置。
  function pin(note) {
    if (closed || !note.isConnected) return;
    paint(note, {
      position: 'fixed',
      'z-index': '4',
      'box-sizing': 'border-box',
      left: '8px',
      right: '8px',
      top: 'auto',
      bottom: '8px',
      width: 'auto',
      'max-width': 'none',
    });
    reserve(note);
  }

  function stop() {
    closed = true;
    if (watch) {
      watch.disconnect();
      watch = null;
    }
    if (sizeWatch) {
      sizeWatch.disconnect();
      sizeWatch = null;
    }
    release();
  }

  function show() {
    if (dismissed()) return;
    if (document.getElementById(NOTE_ID)) return;
    if (!document.body) return;

    var note = document.createElement('div');
    note.id = NOTE_ID;
    paint(note, {
      position: 'fixed',
      'z-index': '4',
      'box-sizing': 'border-box',
      left: '8px',
      right: '8px',
      bottom: '8px',
      display: 'flex',
      'flex-wrap': 'wrap',
      'align-items': 'center',
      gap: '8px',
      padding: '8px',
      color: 'var(--hud-text)',
      'background-color': 'var(--hud-solid)',
      'border-width': '1px',
      'border-style': 'solid',
      'border-color': 'var(--hud-line)',
      'font-family': 'var(--hud-font-body)',
      'font-size': '13px',
      'line-height': '1.35',
      'pointer-events': 'none',
    });

    var text = document.createElement('span');
    text.textContent = TEXT;
    paint(text, { flex: '1 1 12em', color: 'var(--hud-text)' });

    var button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('data-hud', 'button');
    paint(button, { 'pointer-events': 'auto', 'flex-shrink': '0' });
    var label = document.createElement('span');
    label.className = 'hud-button-label';
    label.textContent = '知道了';
    button.appendChild(label);
    button.addEventListener('click', function () {
      try {
        localStorage.setItem(KEY, '1');
      } catch (err) {
        /* 存不到就還是先收起來 */
      }
      stop();
      note.remove();
    });

    note.appendChild(text);
    note.appendChild(button);
    document.body.appendChild(note);
    pin(note);

    if (typeof ResizeObserver === 'function') {
      sizeWatch = new ResizeObserver(function () {
        reserve(note);
      });
      sizeWatch.observe(note);
    }

    // 換畫面時 Svelte 通常不換 .hud-body;留著是為了它晚出現、或真的被換掉時重新記原本的值。
    // 改 inline style 不會觸發 childList,不會跟自己叫來叫去。按掉之後 stop() 會拆掉。
    if (typeof MutationObserver === 'function' && !watch) {
      watch = new MutationObserver(function () {
        pin(note);
      });
      watch.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', show);
  } else {
    show();
  }
})();
