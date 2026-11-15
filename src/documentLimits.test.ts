import { describe, expect, it } from 'vitest';
import { CALCULATION_TIMEOUT, MAX_CALCULATION_INPUT } from './lib/worker/calculationLimits';
import { CLOUD_POLICIES, CLOUD_POLICY_CHECKED_AT } from './tools/subnet/cloudPolicy';
import { DETAIL_PREVIEW_LIMIT, TEXT_PREVIEW_LIMIT, VALUE_PREVIEW_LIMIT } from './lib/text/textPreview';
import { HEX_DUMP_MAX, MAX_FILE as BASE64_MAX_FILE, SYNC_LIMIT } from './tools/base64/logic';
import { HOLIDAY_MAX_YEAR, HOLIDAY_MIN_YEAR } from './tools/business-days/holidays';
import { MAX_BUSINESS_DAYS, MAX_SPAN_YEARS } from './tools/business-days/logic';
import { MAX_INPUT as CERT_MAX_INPUT, MAX_PEM_BLOCKS } from './tools/cert/pem';
import { MAX_NAME_ATTRS } from './tools/cert/name';
import { SEARCH_YEARS } from './tools/cron/nextRuns';
import { MAX_INPUT as CRON_MAX_INPUT } from './tools/cron/parse';
import { MAX_CSV_CELLS, MAX_CSV_OUTPUT } from './tools/csv-json/csvFormat';
import { MAX_FILE as HASH_MAX_FILE, MD5_CHUNK } from './tools/hash/logic';
import { MAX_OUTPUT as JSON_MAX_OUTPUT } from './tools/json-formatter/logic';
import { MAX_KEY } from './tools/jwt-decoder/keys';
import { MAX_LENGTH, MIN_LENGTH } from './tools/password-generator/logic';
import { MAX_DIGITS, MAX_SHIFT } from './tools/radix/logic';
import { MAX_FLOAT_INPUT } from './tools/radix/float';
import { MAX_GROUPS, MAX_MATCHES, MAX_OUTPUT as REGEX_MAX_OUTPUT, MAX_PATTERN, MAX_TEXT } from './tools/regex/logic';
import { MAX_OVERLAPS, MAX_ROWS } from './tools/subnet/ranges';
import { MAX_VLSM_LINES } from './tools/subnet/vlsm';
import { MAX_AGGREGATE_OUTPUT, MAX_VLSM_OUTPUT } from './tools/subnet/listCalculation';
import { LINE_PAGE_SIZE } from './tools/text-count/logic';
import { DIFF_TIMEOUT_MS } from './tools/text-diff/logic';
import { MIN_DATE } from './tools/wareki/logic';
import { LIST_PREVIEW_LIMIT } from './lib/listPreview';
import { MAX_DURATION_INPUT } from './tools/unix-time/logic';
import { markdown } from './documentSources.testing';
import { containsLimit } from './documentMarkdown.testing';

describe('ドキュメントの制約と定数', () => {
  it('クラウドの案内の参照元と確認日が利用ガイドに載っている', () => {
    const usage = markdown['/docs/USAGE.md'] ?? '';
    expect(usage).toContain(CLOUD_POLICY_CHECKED_AT);
    for (const policy of CLOUD_POLICIES) expect(usage).toContain(policy.source);
  });

  it('上限を別の数値の一部分として見つけない', () => {
    expect(containsLimit('1800万単位', '800万単位')).toBe(false);
    expect(containsLimit('プレビュー先頭150,000単位', '50,000単位')).toBe(false);
    expect(containsLimit('シフト量は0〜4,0960', 'シフト量は0〜4,096')).toBe(false);
    expect(containsLimit('入力800万単位、出力は50,000単位', '800万単位')).toBe(true);
  });

  it('USAGE の上限の表が、各ツールの上限の定数と一致している', () => {
    /** 上限を変えたときに、利用者向けの表の更新が漏れないように。表記は「800万」「4,096」「5 MiB」の形 */
    const man = (n: number) => `${(n / 10_000).toLocaleString('ja-JP')}万`;
    const num = (n: number) => n.toLocaleString('ja-JP');
    const mib = (n: number) => `${n / 1024 ** 2} MiB`;
    const sec = (ms: number) => `${ms / 1000}秒`;
    const expected: Record<string, [string[], string[], string[]]> = {
      'JSON整形': [[`${man(MAX_CALCULATION_INPUT)}単位`], [`整形結果${man(JSON_MAX_OUTPUT)}単位`, `プレビュー先頭${num(TEXT_PREVIEW_LIMIT)}単位`], [`Workerで${sec(CALCULATION_TIMEOUT)}`]],
      'CSV変換': [[`${man(MAX_CALCULATION_INPUT)}単位`, `ファイル${MAX_CALCULATION_INPUT * 3 / 1_000_000}MB`, `展開後${man(MAX_CSV_CELLS)}セル`], [`出力${man(MAX_CSV_OUTPUT)}単位`], []],
      '文字数・バイト数': [[`${man(MAX_CALCULATION_INPUT)}単位`, `UTF-8ファイル${MAX_CALCULATION_INPUT * 3 / 1_000_000}MB`], [`${LINE_PAGE_SIZE}行ずつ`], []],
      'テキスト差分': [[`合計${man(MAX_CALCULATION_INPUT)}単位`], [], [`下記の${sec(DIFF_TIMEOUT_MS)}制限`]],
      'UNIX時間の一括変換': [[`${man(MAX_CALCULATION_INPUT)}単位`], [], [`Workerで${sec(CALCULATION_TIMEOUT)}`]],
      'UNIX時間の期間計算': [[`期間は${num(MAX_DURATION_INPUT)}単位`], [], []],
      '正規表現': [[`式${man(MAX_PATTERN)}単位`, `各${man(MAX_TEXT)}単位`, `キャプチャ${MAX_GROUPS}個`], [`表示${MAX_MATCHES}マッチ`, `置換結果${man(REGEX_MAX_OUTPUT)}単位`], []],
      'Base64 / URLエンコード': [[`テキスト${man(MAX_CALCULATION_INPUT)}単位`, `ファイル${mib(BASE64_MAX_FILE)}`], [`出力は先頭${num(TEXT_PREVIEW_LIMIT)}単位`, `16進ダンプは先頭${HEX_DUMP_MAX / 1024} KiB`, `MIME タイプの表示は先頭${DETAIL_PREVIEW_LIMIT}単位の抜粋`], [`${man(SYNC_LIMIT)}単位を超える`]],
      '進数変換・ビット演算': [[`${num(MAX_DIGITS)}桁`, `浮動小数点の欄は${num(MAX_FLOAT_INPUT)}単位`, `シフト量は0〜${num(MAX_SHIFT)}`], [], []],
      'cron式の解説': [[`${num(CRON_MAX_INPUT)}単位`], [], [`${SEARCH_YEARS}年先`]],
      '和暦 ⇔ 西暦': [[`${MIN_DATE.y}年）${MIN_DATE.m}月${MIN_DATE.d}日以降`], [], []],
      '営業日計算': [[`期間${MAX_SPAN_YEARS}年`, `±${num(MAX_BUSINESS_DAYS)}営業日`, `${HOLIDAY_MIN_YEAR}〜${HOLIDAY_MAX_YEAR}年`], [`先頭${LIST_PREVIEW_LIMIT}件を表示`], []],
      'IPアドレス・サブネット計算': [[`集約・重複チェック・VLSMは${man(MAX_CALCULATION_INPUT)}単位`, `VLSMは${num(MAX_VLSM_LINES)}行`], [`分割の一覧は${num(MAX_ROWS)}件`, `重複の組み合わせは${num(MAX_OVERLAPS)}組`, `集約結果は${man(MAX_AGGREGATE_OUTPUT)}単位`, `先頭${num(TEXT_PREVIEW_LIMIT)}単位`, `全文で${man(MAX_VLSM_OUTPUT)}単位`], [`Worker で${sec(CALCULATION_TIMEOUT)}`]],
      'パスワード生成': [[`長さ${MIN_LENGTH}〜${MAX_LENGTH}文字`], [], []],
      'ハッシュ生成': [[`ファイル${mib(HASH_MAX_FILE)}`], [], [`${mib(MD5_CHUNK)}ずつ`]],
      'JWTデコーダー': [[`公開鍵${num(MAX_KEY)}単位`], [`先頭${num(TEXT_PREVIEW_LIMIT)}単位まで表示`, `先頭${num(VALUE_PREVIEW_LIMIT)}単位まで表示`, `先頭${DETAIL_PREVIEW_LIMIT}単位の抜粋`], []],
      '証明書デコーダー': [[`貼り付け${num(CERT_MAX_INPUT)}単位`, `ファイル${mib(CERT_MAX_INPUT)}`, `PEMは${MAX_PEM_BLOCKS}ブロック`], [`先頭${LIST_PREVIEW_LIMIT}件`, `${num(VALUE_PREVIEW_LIMIT)}単位まで表示`, `発行者の名前は先頭${DETAIL_PREVIEW_LIMIT}単位の抜粋`],[`名前の属性は${MAX_NAME_ATTRS}個`]],
    };
    const usage = markdown['/docs/USAGE.md'] ?? '';
    const rows = new Map(usage.split('\n').filter((line) => line.startsWith('| ')).map((line) => {
      const [, tool, ...cells] = line.split('|').map((cell) => cell.trim());
      return [tool, cells] as const;
    }));
    const missing = Object.entries(expected).flatMap(([tool, columns]) => {
      const cells = rows.get(tool);
      if (!cells) return [`${tool}：表に行がありません`];
      return columns.flatMap((limits, i) =>
        limits.filter((limit) => !containsLimit(cells[i] ?? '', limit)).map((limit) => `${tool}：列${i + 1}に「${limit}」がありません`));
    });
    expect(missing).toEqual([]);
  });
});
