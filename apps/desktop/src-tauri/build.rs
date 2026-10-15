fn main() {
    // 真前端由 tauri.conf.json 的 beforeDevCommand / beforeBuildCommand(npm run build:frontends)
    // 建進 frontendDist(../dist,gitignored)。不經 tauri CLI 直接 cargo build / cargo test 時,
    // 那個資料夾可能還不存在,generate_context! 會因此 panic;先建一個空的,殼與測試照樣編得過
    // (那樣編出來的視窗是空白的,真前端要走 npm run tauri dev / build)。
    let _ = std::fs::create_dir_all("../dist");
    tauri_build::build()
}
