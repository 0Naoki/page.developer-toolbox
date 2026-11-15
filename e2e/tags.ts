/**
 * Chromium・Firefox・WebKitのPC幅で動かすテストの印。
 * Android・iPhoneでは、この印のある表示・メニュー・ナビゲーションのケースだけを動かす。
 * 印のないテスト（ツールの計算や表示の確認）は、Chromium の PC 幅（desktop）だけで動かす。
 * ブラウザによって差が出るもの（CSP・Trusted Types、Web Crypto・TextDecoder・Intl、キー操作やフォーカス、
 * 保存領域やクリップボード）に付ける
 */
export const CROSS_BROWSER = { tag: '@cross-browser' };
