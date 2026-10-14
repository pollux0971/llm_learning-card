/**
 * 首次啟動與路徑設定的決定(不開視窗)。
 * 設定檔是 JSON:`{ "learningDir": "<absolute path>" }`。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export interface StartupDecision {
  askChoose: boolean;
  offerInit: boolean;
  notFound: boolean;
  askAgain: boolean;
}

interface ConfigFile {
  learningDir?: string;
}

export function decideStartup(configPath: string): StartupDecision {
  if (!existsSync(configPath)) {
    return { askChoose: true, offerInit: true, notFound: false, askAgain: false };
  }
  const raw = JSON.parse(readFileSync(configPath, 'utf8')) as ConfigFile;
  const dir = raw.learningDir ?? '';
  if (!dir || !existsSync(dir)) {
    return { askChoose: false, offerInit: false, notFound: true, askAgain: true };
  }
  return { askChoose: false, offerInit: false, notFound: false, askAgain: false };
}

export function saveChosenPath(configPath: string, chosen: string): void {
  const body: ConfigFile = { learningDir: chosen };
  writeFileSync(configPath, JSON.stringify(body));
}
