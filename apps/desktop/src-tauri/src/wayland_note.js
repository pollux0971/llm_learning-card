// Wayland 一次性提示。Rust 只在 Wayland 把這份檔接在 window_mode 的 init script 後面
// (initialization_script,document 還沒有 body)。等頁面載入完才畫,按掉之後寫 localStorage,之後不再出現。
// 樣式只走 CSSOM 與 HUD 掛鉤,顏色只用 var(--hud-*)。不碰網路、不碰 invoke。
(function () {
  var KEY = 'lc-wayland-note-dismissed';
  var TEXT = 'Wayland 底下無法強制視窗置頂,請在桌面環境設定「永遠在最上層」。';
  var NOTE_ID = 'lc-wayland-note';
  var watch = null;

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

  function viewSize() {
    return {
      w: window.innerWidth || document.documentElement.clientWidth || 0,
      h: window.innerHeight || document.documentElement.clientHeight || 0,
    };
  }

  function otherCenters(note) {
    var out = [];
    var buttons = document.querySelectorAll('button');
    var i;
    for (i = 0; i < buttons.length; i += 1) {
      var b = buttons[i];
      if (note.contains(b)) continue;
      var q = b.getBoundingClientRect();
      if (q.width <= 0 || q.height <= 0) continue;
      out.push({ x: q.left + q.width / 2, y: q.top + q.height / 2 });
    }
    return out;
  }

  function covers(rect, centers) {
    var i;
    for (i = 0; i < centers.length; i += 1) {
      var c = centers[i];
      if (c.x >= rect.left && c.x <= rect.right && c.y >= rect.top && c.y <= rect.bottom) return true;
    }
    return false;
  }

  function clampInside(note) {
    var view = viewSize();
    var rect = note.getBoundingClientRect();
    if (rect.left < 0) note.style.setProperty('left', '0px');
    if (view.w > 0 && rect.right > view.w) note.style.setProperty('right', '0px');
    if (view.h > 0 && rect.bottom > view.h) note.style.setProperty('bottom', '8px');
    if (rect.top < 0) {
      note.style.setProperty('top', '8px');
      note.style.setProperty('bottom', 'auto');
    }
  }

  // 先靠底部、橫向留白。蓋到別的按鈕中心就往上挪;還蓋到就改成右下角的窄條,避開左對齊的卡片按鈕。
  function place(note) {
    if (!note.isConnected) return;
    var gap = '8px';
    paint(note, {
      position: 'fixed',
      'z-index': '4',
      'box-sizing': 'border-box',
      left: gap,
      right: gap,
      top: 'auto',
      bottom: gap,
      width: 'auto',
      'max-width': 'none',
    });
    var centers = otherCenters(note);
    var view = viewSize();
    var bottom = 8;
    var guard = 0;
    while (covers(note.getBoundingClientRect(), centers) && guard < 24) {
      var h = note.getBoundingClientRect().height || 40;
      bottom += Math.max(12, Math.ceil(h / 2));
      if (view.h > 0 && bottom + 24 > view.h) break;
      note.style.setProperty('bottom', bottom + 'px');
      guard += 1;
    }
    if (covers(note.getBoundingClientRect(), centers)) {
      paint(note, {
        left: 'auto',
        right: gap,
        bottom: gap,
        top: 'auto',
        width: 'auto',
        'max-width': '46%',
      });
      bottom = 8;
      guard = 0;
      while (covers(note.getBoundingClientRect(), centers) && guard < 24) {
        var narrowH = note.getBoundingClientRect().height || 40;
        bottom += Math.max(12, Math.ceil(narrowH / 2));
        if (view.h > 0 && bottom + 24 > view.h) break;
        note.style.setProperty('bottom', bottom + 'px');
        guard += 1;
      }
    }
    clampInside(note);
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
      if (watch) watch.disconnect();
      note.remove();
    });

    note.appendChild(text);
    note.appendChild(button);
    document.body.appendChild(note);
    place(note);

    if (typeof MutationObserver === 'function' && !watch) {
      watch = new MutationObserver(function () {
        place(note);
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
