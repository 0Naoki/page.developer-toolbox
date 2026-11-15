import { defineConfig, devices } from '@playwright/test';
import { pagesPreviewUrl } from './pages-preview.config';

/** モバイル環境では全ツールの表示と、画面幅に依存するメニュー・ナビゲーションを検査する。 */
const MOBILE_TEST_FILES = ['**/smoke.spec.ts', '**/mobile-navigation.spec.ts', '**/navigation.spec.ts'];

/** 本番ビルド（CSP付き）を GitHub Pages と同じくサブパスの配下に配信し、ブラウザで確認する（パスの名前は pages-preview.config.ts）。 */
export default defineConfig({
  testDir: './e2e',
  /** ソースを変えた後にビルドし直していなければ、古い dist を検査せずに止める */
  globalSetup: './e2e/globalSetup.mjs',
  /** 各ケースの保存領域・時計・Workerを分離し、長いファイルに他の検査を待たせない。 */
  fullyParallel: true,
  workers: '50%',
  /** 通常実行の記録負荷を避ける。再実行で成功してもflakyとして失敗させる。 */
  retries: 1,
  failOnFlakyTests: true,
  timeout: 30_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: pagesPreviewUrl,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  /**
   * Chrome・Edge（Chromium）、Firefox、Safari（WebKit）の3種類と、Android・iPhone の画面幅で確認する。
   * ChromiumのPC幅で全件、Firefox・WebKitのPC幅でCROSS_BROWSERを付けたケースを検査する。
   * Android・iPhoneでは、そのうち表示・メニュー・ナビゲーションだけを検査する。
   * 1つだけ実行するときは --project=webkit のように指定する
   */
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: MOBILE_TEST_FILES, grep: /@cross-browser/ },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, grep: /@cross-browser/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, grep: /@cross-browser/ },
    { name: 'iphone', use: { ...devices['iPhone 14'] }, testMatch: MOBILE_TEST_FILES, grep: /@cross-browser/ },
  ],
  webServer: {
    command: 'npm run serve:pages',
    url: pagesPreviewUrl,
    /** 残っている古いプレビューに対してテストしないよう、ポートが使用中ならエラーにする */
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
