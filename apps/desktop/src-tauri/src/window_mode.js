var root = document.documentElement;
if (root) {
  var mode = window.__LC_WINDOW_MODE__;
  if (mode && mode.frameless) root.classList.add("hud-frameless");
  if (mode && mode.solid) root.classList.add("hud-solid");
}
