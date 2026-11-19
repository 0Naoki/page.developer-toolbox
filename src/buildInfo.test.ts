import { expect, it } from 'vitest';
import { APP_COMMIT, APP_VERSION, VERSION_LABEL } from './buildInfo';

const packageJson = Object.values(import.meta.glob<string>('/package.json', { query: '?raw', import: 'default', eager: true }))[0] ?? '{}';
const bugReport = Object.values(import.meta.glob<string>('/.github/ISSUE_TEMPLATE/bug_report.yml', { query: '?raw', import: 'default', eager: true }))[0] ?? '';

it('版は package.json の version と、ビルドしたコミット（手元は local）を埋め込む', () => {
  expect(APP_VERSION).toBe((JSON.parse(packageJson) as { version: string }).version);
  expect(APP_COMMIT).toMatch(/^(?:[0-9a-f]{7}|local)$/);
  expect(VERSION_LABEL).toBe(`v${APP_VERSION}（${APP_COMMIT}）`);
});

it('不具合の報告のテンプレートに、画面の版を書く必須の欄がある', () => {
  expect(bugReport).toMatch(/id: version\n\s+attributes:\n\s+label: 版\n[\s\S]*?validations:\n\s+required: true/);
});
