/**
 * ビルドに埋め込んだ版（vite.config.ts の define）。
 *
 * @remarks
 * 不具合の報告（.github/ISSUE_TEMPLATE/bug_report.yml）で、どの版で起きたかを書いてもらうため、画面に表示する。
 * 版は package.json の version（リリースのタグ v0.1.0 などと同じ）、コミットはビルドしたコミットの先頭7文字（手元のビルドは local）。
 */
declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;

/** package.json の version */
export const APP_VERSION: string = __APP_VERSION__;
/** ビルドしたコミットの先頭7文字。手元のビルドは local */
export const APP_COMMIT: string = __APP_COMMIT__;
/** 画面と不具合の報告に書く版の表記（「v0.1.0（abc1234）」） */
export const VERSION_LABEL = `v${APP_VERSION}（${APP_COMMIT}）`;
