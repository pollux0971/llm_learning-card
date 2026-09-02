/**
 * Session 類型偵測(X11 / Wayland)。純函式,規則與 `src-tauri/src/session.rs` 一致。
 * 這份是實際跑驗收(phase-1.feature「Detecting the session type」)的一份;
 * Rust 那份是執行期實際判斷置頂行為用的,兩邊各自有測試,避免只測一邊漏掉另一邊壞掉。
 */

export type SessionType = 'x11' | 'wayland';

export interface SessionEnv {
  sessionType?: string | undefined;
  display?: string | undefined;
}

export function detectSessionType(env: SessionEnv): SessionType {
  if (env.sessionType === 'wayland') return 'wayland';
  if (env.display) return 'wayland';
  return 'x11';
}
