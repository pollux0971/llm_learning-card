import { mount } from 'svelte';
import { isTauri } from '@tauri-apps/api/core';
import { createLearningFs } from '../../desktop/src/webview/learning-fs.js';
import { createReviewClient } from '../../desktop/src/webview/review-client.js';
import App from './App.svelte';
import type { SessionDeps } from './session.js';

function browserFs(): SessionDeps['fs'] {
  return {
    async read(): Promise<string> {
      throw new Error('單獨執行不讀檔');
    },
  };
}

function createDeps(): SessionDeps {
  if (isTauri()) {
    return { client: createReviewClient(), fs: createLearningFs() };
  }
  return {
    client: createReviewClient({
      handler: (line) => fetch('/__review', { method: 'POST', body: line }).then((r) => r.text()),
    }),
    fs: browserFs(),
  };
}

const app = mount(App, { target: document.getElementById('app')!, props: { deps: createDeps() } });

export default app;
