import { MAX_MONTH_ORDINAL } from './tools/business-days/numericInput';
/** 利用ガイドの上限IDと、実装の定数から作る期待値。文章の言い回しは契約に含めない。 */
import { CALCULATION_TIMEOUT, MAX_CALCULATION_INPUT } from './lib/worker/calculationLimits';
import { DETAIL_PREVIEW_LIMIT, TEXT_PREVIEW_LIMIT, VALUE_PREVIEW_LIMIT } from './lib/text/textPreview';
import { HEX_DUMP_MAX, MAX_FILE as BASE64_MAX_FILE, SYNC_LIMIT } from './tools/base64/logic';
import { HOLIDAY_MAX_YEAR, HOLIDAY_MIN_YEAR } from './tools/business-days/holidays';
import { MAX_BUSINESS_DAYS, MAX_SPAN_YEARS } from './tools/business-days/logic';
import { MAX_INPUT as CERT_MAX_INPUT, MAX_PEM_BLOCKS } from './tools/cert/pem';
import { MAX_NAME_ATTRS } from './tools/cert/name';
import { HEX_PREVIEW_BYTES } from './tools/cert/extensions';
import { SEARCH_YEARS } from './tools/cron/nextRuns';
import { MAX_INPUT as CRON_MAX_INPUT } from './tools/cron/parse';
import { MAX_CSV_CELLS, MAX_CSV_OUTPUT } from './tools/csv-json/csvFormat';
import { MAX_FILE as HASH_MAX_FILE, MD5_CHUNK } from './tools/hash/logic';
import { MAX_OUTPUT as JSON_MAX_OUTPUT } from './tools/json-formatter/logic';
import { MAX_TREE_INPUT, TREE_CHILD_PAGE } from './tools/json-formatter/tree';
import { MAX_KEY } from './tools/jwt-decoder/keys';
import { CONFIG_PREVIEW_LIMIT, MAX_LENGTH, MIN_LENGTH } from './tools/password-generator/logic';
import { MAX_DIGITS, MAX_SHIFT } from './tools/radix/logic';
import { MAX_FLOAT_INPUT } from './tools/radix/float';
import { MAX_GROUPS, MAX_MATCHES, MAX_OUTPUT as REGEX_MAX_OUTPUT, MAX_PATTERN, MAX_TEXT } from './tools/regex/logic';
import { MAX_OVERLAPS, MAX_ROWS, MAX_SPLIT_OUTPUT_ROWS } from './tools/subnet/ranges';
import { MAX_VLSM_LINES } from './tools/subnet/vlsm';
import { MAX_AGGREGATE_OUTPUT, MAX_VLSM_OUTPUT } from './tools/subnet/listCalculation';
import { LINE_PAGE_SIZE } from './tools/text-count/logic';
import { COUNT_INPUT_PREVIEW, DIVERSE_INPUT_PREVIEW, ISSUE_GLYPH_PREVIEW, MAX_LISTED } from './tools/text-count/characterDetails';
import { INVISIBLE_PREVIEW_LENGTH } from './tools/text-count/invisible';
import { MAX_REPORT_OUTPUT } from './tools/text-count/reports';
import { DIFF_TIMEOUT_MS } from './tools/text-diff/logic';
import { MIN_DATE } from './tools/wareki/logic';
import { LIST_PREVIEW_LIMIT } from './lib/listPreview';
import { MAX_DURATION_INPUT } from './tools/unix-time/logic';
import type { DocumentLimit, DocumentLimits } from './documentMarkdown.testing';
const limit = (id: string, expected: string): DocumentLimit => ({ id, expected });

const man = (n: number) => `${(n / 10_000).toLocaleString('ja-JP')}万`;
const num = (n: number) => n.toLocaleString('ja-JP');
const mib = (n: number) => `${n / 1024 ** 2} MiB`;
const sec = (ms: number) => `${ms / 1000}秒`;
export const DOCUMENT_LIMITS: DocumentLimits = {
  'JSON整形': [[limit('json.input', `${man(MAX_CALCULATION_INPUT)}単位`)], [limit('json.output', `整形結果${man(JSON_MAX_OUTPUT)}単位`), limit('json.preview', `プレビュー先頭${num(TEXT_PREVIEW_LIMIT)}単位`), limit('json.tree-input', `ツリー表示は入力${man(MAX_TREE_INPUT)}単位まで`), limit('json.tree-page', `子は${num(TREE_CHILD_PAGE)}件ずつ表示`)], [limit('json.timeout', `Workerで${sec(CALCULATION_TIMEOUT)}`)]],
  'CSV変換': [[limit('csv.input', `${man(MAX_CALCULATION_INPUT)}単位`), limit('csv.file', `ファイル${MAX_CALCULATION_INPUT * 3 / 1_000_000}MB`), limit('csv.cells', `展開後${man(MAX_CSV_CELLS)}セル`)], [limit('csv.output', `出力${man(MAX_CSV_OUTPUT)}単位`)], []],
  '文字数・バイト数': [[limit('count.input', `${man(MAX_CALCULATION_INPUT)}単位`), limit('count.file', `${MAX_CALCULATION_INPUT * 3 / 1_000_000}MB`)], [limit('count.page', `${LINE_PAGE_SIZE}行ずつ`),
    limit('count.kinds', `${MAX_LISTED}種類`), limit('count.positions', `${MAX_LISTED}件`), limit('count.invisible-preview', `${INVISIBLE_PREVIEW_LENGTH.toLocaleString('ja-JP')}単位`),
    limit('count.input-preview', `${DIVERSE_INPUT_PREVIEW.toLocaleString('ja-JP')}〜${COUNT_INPUT_PREVIEW.toLocaleString('ja-JP')}単位`), limit('count.glyph-preview', `${ISSUE_GLYPH_PREVIEW}種類`),
    limit('count.report', `${man(MAX_REPORT_OUTPUT)}単位`)], [limit('count.timeout', `${CALCULATION_TIMEOUT / 1000}秒`)]],
  'テキスト差分': [[limit('diff.input', `合計${man(MAX_CALCULATION_INPUT)}単位`)], [], [limit('diff.search-timeout', `下記の${sec(DIFF_TIMEOUT_MS)}制限`)]],
  'UNIX時間の一括変換': [[limit('epoch.input', `${man(MAX_CALCULATION_INPUT)}単位`)], [], [limit('epoch.timeout', `Workerで${sec(CALCULATION_TIMEOUT)}`)]],
  'UNIX時間の期間計算': [[limit('epoch.duration-input', `期間は${num(MAX_DURATION_INPUT)}単位`)], [], []],
  '正規表現': [[limit('regex.pattern', `式${man(MAX_PATTERN)}単位`), limit('regex.text', `各${man(MAX_TEXT)}単位`), limit('regex.groups', `キャプチャ${MAX_GROUPS}個`)], [limit('regex.matches', `表示${MAX_MATCHES}マッチ`), limit('regex.output', `置換結果${man(REGEX_MAX_OUTPUT)}単位`)], []],
  'Base64 / URLエンコード': [[limit('base64.input', `テキスト${man(MAX_CALCULATION_INPUT)}単位`), limit('base64.file', `ファイル${mib(BASE64_MAX_FILE)}`)], [limit('base64.preview', `出力は先頭${num(TEXT_PREVIEW_LIMIT)}単位`), limit('base64.hex', `${HEX_DUMP_MAX / 1024} KiB`), limit('base64.mime', `MIME タイプの表示は先頭${DETAIL_PREVIEW_LIMIT}単位の抜粋`)], [limit('base64.sync', `${man(SYNC_LIMIT)}単位を超える`)]],
  '進数変換・ビット演算': [[limit('radix.digits', `${num(MAX_DIGITS)}桁`), limit('radix.float', `浮動小数点の欄は${num(MAX_FLOAT_INPUT)}単位`), limit('radix.shift', `シフト量は0〜${num(MAX_SHIFT)}`)], [], []],
  'cron式の解説': [[limit('cron.input', `${num(CRON_MAX_INPUT)}単位`)], [], [limit('cron.years', `${SEARCH_YEARS}年先`)]],
  '和暦 ⇔ 西暦': [[limit('wareki.minimum', `${MIN_DATE.y}年）${MIN_DATE.m}月${MIN_DATE.d}日以降`)], [], []],
  '営業日計算': [[limit('business.ordinal', `第n営業日は1〜${MAX_MONTH_ORDINAL}の整数`), limit('business.span', `期間${MAX_SPAN_YEARS}年`), limit('business.offset', `±${num(MAX_BUSINESS_DAYS)}営業日`), limit('business.holiday-years', `${HOLIDAY_MIN_YEAR}〜${HOLIDAY_MAX_YEAR}年`)], [limit('business.preview', `先頭${LIST_PREVIEW_LIMIT}件を表示`)], []],
  'IPアドレス・サブネット計算': [[limit('subnet.input', `集約・重複チェック・VLSMは${man(MAX_CALCULATION_INPUT)}単位`), limit('subnet.vlsm-lines', `VLSMは${num(MAX_VLSM_LINES)}行`)], [limit('subnet.split-preview', `分割の一覧は${num(MAX_ROWS)}件`), limit('subnet.split-output', `均等分割の全件出力は${num(MAX_SPLIT_OUTPUT_ROWS)}件まで`), limit('subnet.overlaps', `重複の組み合わせは${num(MAX_OVERLAPS)}組`), limit('subnet.aggregate-output', `集約結果は${man(MAX_AGGREGATE_OUTPUT)}単位`), limit('subnet.preview', `先頭${num(TEXT_PREVIEW_LIMIT)}単位`), limit('subnet.vlsm-output', `全文で${man(MAX_VLSM_OUTPUT)}単位`)], [limit('subnet.timeout', `Worker で${sec(CALCULATION_TIMEOUT)}`)]],
  'パスワード生成': [[limit('password.length', `長さ${MIN_LENGTH}〜${MAX_LENGTH}文字`)], [limit('password.config-preview', `${num(CONFIG_PREVIEW_LIMIT)}単位`)], []],
  'ハッシュ生成': [[limit('hash.file', `ファイル${mib(HASH_MAX_FILE)}`)], [], [limit('hash.chunk', `${mib(MD5_CHUNK)}ずつ`)]],
  'JWTデコーダー': [[limit('jwt.input', `${man(MAX_CALCULATION_INPUT)}単位`), limit('jwt.key', `公開鍵${num(MAX_KEY)}単位`)], [limit('jwt.preview', `先頭${num(TEXT_PREVIEW_LIMIT)}単位まで表示`), limit('jwt.claim', `先頭${num(VALUE_PREVIEW_LIMIT)}単位まで表示`), limit('jwt.detail', `先頭${DETAIL_PREVIEW_LIMIT}単位の抜粋`)], [limit('jwt.timeout', `Workerで${sec(CALCULATION_TIMEOUT)}`)]],
  '証明書デコーダー': [[limit('cert.input', `貼り付け${num(CERT_MAX_INPUT)}単位`), limit('cert.file', `ファイル${mib(CERT_MAX_INPUT)}`), limit('cert.blocks', `PEMは${MAX_PEM_BLOCKS}ブロック`)], [limit('cert.list', `先頭${LIST_PREVIEW_LIMIT}件`), limit('cert.value', `${num(VALUE_PREVIEW_LIMIT)}単位まで表示`), limit('cert.issuer', `発行者の名前は先頭${DETAIL_PREVIEW_LIMIT}単位の抜粋`), limit('cert.raw-preview', `${HEX_PREVIEW_BYTES}バイト`)],[limit('cert.attributes', `名前の属性は${MAX_NAME_ATTRS}個`)]],
};
