import assert from 'node:assert/strict';
import { test } from 'node:test';
import { packageDirOf, thirdPartyLicenseText } from './third-party-licenses.mjs';
import { temporaryRepository } from './benchmark-test-fixtures.mjs';

const pkg = (name, version, license = 'MIT') => JSON.stringify({ name, version, license });

test('モジュールの ID から、所属するパッケージのフォルダを求める（スコープ付き・入れ子・Windows のパス・仮想モジュール）', () => {
  assert.equal(packageDirOf('/repo/node_modules/react/cjs/react.production.js', '/repo'), '/repo/node_modules/react');
  assert.equal(packageDirOf('C:\\repo\\node_modules\\@scope\\pkg\\dist\\a.js?commonjs-es-import', 'C:/repo'), 'C:/repo/node_modules/@scope/pkg');
  assert.equal(packageDirOf('/repo/node_modules/a/node_modules/b/index.js', '/repo'), '/repo/node_modules/a/node_modules/b');
  assert.equal(packageDirOf('\0vite/preload-helper.js', '/repo'), '/repo/node_modules/vite');
  assert.equal(packageDirOf('\0rolldown/runtime.js', '/repo'), '/repo/node_modules/rolldown');
  assert.equal(packageDirOf('/repo/src/main.tsx', '/repo'), null);
  assert.equal(packageDirOf('\0other-virtual', '/repo'), null);
  assert.equal(packageDirOf('/repo/node_modules/@scope', '/repo'), null);
});

test('パッケージごとに1回だけ、名前の順にライセンスの本文を載せる', (t) => {
  const { root, write } = temporaryRepository(t);
  write('node_modules/zeta/package.json', pkg('zeta', '1.0.0'));
  write('node_modules/zeta/LICENSE.md', 'Copyright (c) Zeta\r\n');
  write('node_modules/@scope/alpha/package.json', pkg('@scope/alpha', '2.0.0', 'ISC'));
  write('node_modules/@scope/alpha/LICENSE', 'Copyright (c) Alpha');
  const text = thirdPartyLicenseText([
    `${root}/node_modules/zeta/a.js`,
    `${root}/node_modules/zeta/b.js`,
    `${root}/node_modules/@scope/alpha/index.js`,
    `${root}/src/main.tsx`,
  ], root);
  assert.equal(text.match(/zeta@1\.0\.0（MIT）/g)?.length, 1);
  assert.ok(text.indexOf('@scope/alpha@2.0.0（ISC）') < text.indexOf('zeta@1.0.0'));
  assert.match(text, /Copyright \(c\) Zeta\n/);
  assert.doesNotMatch(text, /\r/);
  assert.doesNotMatch(text, /main\.tsx/);
});

test('ライセンスの本文や種類がないパッケージがあれば、著作権表示のない配布物を作らないよう失敗する', (t) => {
  const { root, write } = temporaryRepository(t);
  write('node_modules/nofile/package.json', pkg('nofile', '1.0.0'));
  write('node_modules/nofile/index.js', '');
  assert.throws(() => thirdPartyLicenseText([`${root}/node_modules/nofile/index.js`], root), /nofile@1\.0\.0 のライセンスの本文/);
  write('node_modules/nolicense/package.json', JSON.stringify({ name: 'nolicense', version: '1.0.0' }));
  write('node_modules/nolicense/LICENSE', 'text');
  assert.throws(() => thirdPartyLicenseText([`${root}/node_modules/nolicense/index.js`], root), /name・version・license がありません/);
  for (const [name, body] of [['emptylicense', ''], ['blanklicense', ' \r\n\t\n']]) {
    write(`node_modules/${name}/package.json`, pkg(name, '1.0.0'));
    write(`node_modules/${name}/LICENSE`, body);
    assert.throws(() => thirdPartyLicenseText([`${root}/node_modules/${name}/index.js`], root), new RegExp(`${name}@1\\.0\\.0 のライセンスの本文（LICENSE）が空です`));
  }
});
