/**
 * 側車的第一個 import(ADR-075):在任何依賴載入之前,把 console.log / info / debug / warn 導到 stderr。
 * stdout 只准協定行,由框線程式用 process.stdout.write 寫。
 */
const toStderr = console.error.bind(console);
console.log = toStderr;
console.info = toStderr;
console.debug = toStderr;
console.warn = toStderr;
