/**
 * T64:一次 cucumber 行程一個暫存快取目錄(D1)。BeforeAll 把 XDG_CACHE_HOME 指過去,AfterAll 刪掉並還原。
 * 自己已指了 XDG_CACHE_HOME 的 harness 照舊用自己的(它們把 process.env 的值拿掉再設);沒指的(例如 i2 的 childEnv)自動帶到這裡。
 */
import { AfterAll, BeforeAll } from '@cucumber/cucumber';
import { installHermeticCache, type HermeticCache } from '../support/hermetic-cache.js';

let installed: HermeticCache | undefined;

BeforeAll(function () {
  installed = installHermeticCache();
});

AfterAll(function () {
  installed?.restore();
  installed = undefined;
});
