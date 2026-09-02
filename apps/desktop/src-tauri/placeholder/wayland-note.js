// Rust 在偵測到 Wayland session 時呼叫這個函式(見 src-tauri/src/main.rs)。
// 只顯示一次:是否已看過存在 localStorage,關掉就永久不再顯示。
const DISMISSED_KEY = 'lc-wayland-note-dismissed';

window.__lcShowWaylandNote = function showWaylandNote() {
  if (localStorage.getItem(DISMISSED_KEY) === '1') return;
  if (document.getElementById('wayland-note')) return;

  const note = document.createElement('div');
  note.id = 'wayland-note';
  note.innerHTML =
    '<span>Wayland 底下無法強制視窗置頂,請在桌面環境設定「永遠在最上層」。</span>' +
    '<button type="button">知道了</button>';
  note.querySelector('button').addEventListener('click', () => {
    localStorage.setItem(DISMISSED_KEY, '1');
    note.remove();
  });
  document.body.appendChild(note);
};
