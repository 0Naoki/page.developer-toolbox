import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { captureStyleStates, compareSnapshots, serveStyleBuild } from './style-comparison.mjs';

test('ビルドだけを配信し、範囲外と不正なURLの後も応答する', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'style-server-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const build = join(root, 'build');
  await mkdir(build);
  await writeFile(join(build, 'index.html'), '<h1>build</h1>');
  await writeFile(join(root, 'outside.txt'), 'outside-build');
  const { server, url } = await serveStyleBuild(build);
  t.after(() => new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close(error => error ? reject(error) : resolve());
  }));
  for (const path of ['..%2foutside.txt', '..%5coutside.txt']) {
    const response = await fetch(url + path);
    assert.notEqual(await response.text(), 'outside-build');
    assert.equal(response.status, 404);
  }
  assert.equal((await fetch(url + '%')).status, 400);
  assert.equal(await (await fetch(url)).text(), '<h1>build</h1>');
});

test('状態と要素の追加・削除を両方向で検出する', () => {
  const node = { hash: 'same', cls: 'notice' };
  const before = { initial: { body: node } };
  const after = { initial: { body: node, 'body>div:0': node }, sample: { body: node } };
  assert.deepEqual(compareSnapshots(before, before).differences, []);
  assert.equal(compareSnapshots(before, after).differences.length, 2);
  assert.equal(compareSnapshots(after, before).differences.length, 2);
  assert.equal(compareSnapshots(before, { initial: { body: { ...node, hash: 'changed' } } }).differences.length, 1);
});

test('サンプル前の初期状態と、サンプル後を別々に記録する', async () => {
  let sampled = false;
  const page = {
    evaluate: async () => ({ sampled }),
    getByRole: () => ({ count: async () => 1, first: () => ({ click: async () => { sampled = true; } }) }),
    waitForTimeout: async () => {},
    locator: () => ({ count: async () => 0 }),
  };
  const states = await captureStyleStates(page, 'tool', () => {}, []);
  assert.deepEqual(states['tool 初期'], { sampled: false });
  assert.deepEqual(states['tool サンプル'], { sampled: true });
});

test('親の切り替えで消える子と、同じ位置に現れる別の子も収集する', async () => {
  let tab = '分割', mode = '均等', view = '一覧';
  const groups = () => [
    { name: '機能', labels: ['分割', '集約'], select: (value) => { tab = value; } },
    tab === '分割'
      ? { name: '分け方', labels: ['均等', 'VLSM'], select: (value) => { mode = value; } }
      : { name: '表示', labels: ['一覧', '詳細'], select: (value) => { view = value; } },
  ];
  const page = {
    evaluate: async () => ({ tab, mode, view }),
    getByRole: () => ({ count: async () => 0 }),
    waitForTimeout: async () => {},
    locator: () => ({
      count: async () => groups().length,
      nth: (g) => ({
        getAttribute: async () => groups()[g].name,
        locator: () => ({
          count: async () => groups()[g].labels.length,
          allTextContents: async () => groups()[g].labels,
          nth: (b) => ({
            isVisible: async () => true,
            isEnabled: async () => true,
            textContent: async () => groups()[g].labels[b],
            click: async () => groups()[g].select(groups()[g].labels[b]),
          }),
        }),
      }),
    }),
  };
  const states = Object.values(await captureStyleStates(page, 'tool', () => {}, []));
  assert.ok(states.some((state) => state.tab === '分割' && state.mode === 'VLSM'));
  assert.ok(states.some((state) => state.tab === '集約' && state.view === '詳細'));
});
