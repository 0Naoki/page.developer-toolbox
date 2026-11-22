import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 配布物（dist）に含まれる第三者のパッケージのライセンスを、1つのテキストにまとめる（vite.config.ts の thirdPartyLicenses で使う）。
 *
 * @remarks
 * 本番ビルドは圧縮でコメントを消すため、React などの MIT ライセンスが求める著作権表示が配布物に残らない。
 * バンドルに入ったモジュールの所属するパッケージを調べ、ライセンスの本文を THIRD_PARTY_LICENSES.txt に書き出す。
 * ライセンスの本文が見つからないパッケージがあれば、表示のない配布物を公開しないよう、ビルドを失敗させる。
 */

/** Vite・Rolldown がバンドルに入れる補助のコード（\0 で始まる仮想モジュール）と、そのコードを持つパッケージ */
const VIRTUAL_PACKAGES = [['vite/', 'vite'], ['rolldown/', 'rolldown']];

/** ライセンスの本文のファイル名（LICENSE・LICENSE.md・LICENCE.txt・COPYING など） */
const LICENSE_FILE = /^(?:licen[cs]e|copying)(?:[.-].*)?$/i;

/**
 * モジュールの ID から、所属するパッケージのフォルダを返す。node_modules の外（アプリのソース）なら null。
 *
 * @param {string} id - バンドルのモジュールの ID（絶対パス、または \0 で始まる仮想モジュール）。
 * @param {string} root - リポジトリのフォルダ（仮想モジュールのパッケージを探す場所）。
 * @returns {string | null}
 */
export function packageDirOf(id, root) {
  if (id.startsWith('\0')) {
    const found = VIRTUAL_PACKAGES.find(([prefix]) => id.slice(1).startsWith(prefix));
    return found ? join(root, 'node_modules', found[1]).replace(/\\/g, '/') : null;
  }
  const path = id.replace(/\\/g, '/').split('?')[0] ?? '';
  const marker = '/node_modules/';
  const at = path.lastIndexOf(marker);
  if (at < 0) return null;
  const rest = path.slice(at + marker.length).split('/');
  const scoped = rest[0]?.startsWith('@') ?? false;
  const name = rest.slice(0, scoped ? 2 : 1);
  if (name.length !== (scoped ? 2 : 1) || name.some((part) => !part)) return null;
  return path.slice(0, at + marker.length) + name.join('/');
}

/**
 * パッケージの名前・版・ライセンスの種類と本文を読む。
 *
 * @param {string} dir - パッケージのフォルダ。
 * @throws package.json の名前・版・ライセンスの種類か、ライセンスの本文のファイルがない場合。本文が空（空白だけ）の場合。
 */
function readPackage(dir) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const license = typeof pkg.license === 'string' ? pkg.license : null;
  if (typeof pkg.name !== 'string' || typeof pkg.version !== 'string' || !license) {
    throw new Error(`${dir}/package.json に name・version・license がありません`);
  }
  const file = readdirSync(dir).filter((name) => LICENSE_FILE.test(name)).sort()[0];
  if (!file) throw new Error(`${pkg.name}@${pkg.version} のライセンスの本文（LICENSE など）が見つかりません。配布物に著作権表示を含められないため、ビルドを止めます`);
  const text = readFileSync(join(dir, file), 'utf8').replace(/\r\n?/g, '\n').trim();
  /** ファイルがあっても本文が空なら、著作権表示を含められない */
  if (!text) throw new Error(`${pkg.name}@${pkg.version} のライセンスの本文（${file}）が空です。配布物に著作権表示を含められないため、ビルドを止めます`);
  return { name: pkg.name, version: pkg.version, license, text };
}

/**
 * バンドルに入ったモジュールの ID から、THIRD_PARTY_LICENSES.txt の本文を作る。
 * パッケージは名前の順に並べ、同じ名前と版は1回だけ載せる（同じ入力からは同じ内容になる）。
 *
 * @param {Iterable<string>} moduleIds - バンドル（Worker を含む）に入ったモジュールの ID。
 * @param {string} root - リポジトリのフォルダ。
 * @returns {string}
 */
export function thirdPartyLicenseText(moduleIds, root) {
  const dirs = new Set();
  for (const id of moduleIds) {
    const dir = packageDirOf(id, root);
    if (dir) dirs.add(dir);
  }
  const packages = new Map();
  for (const dir of dirs) {
    const pkg = readPackage(dir);
    packages.set(`${pkg.name}@${pkg.version}`, pkg);
  }
  const sorted = [...packages.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : 1));
  const line = '='.repeat(80);
  const sections = sorted.map((p) => `${line}\n${p.name}@${p.version}（${p.license}）\n${line}\n\n${p.text}\n`);
  return [
    'このサイトの配布物に含まれる第三者のソフトウェアと、そのライセンスです（ビルドのときに自動で作成しています）。',
    'This file lists the third-party software included in this site and their licenses.',
    '',
    ...sections,
  ].join('\n');
}
