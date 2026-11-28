/** JWT の診断：時刻クレームの値の判定と、ヘッダ・クレームの警告（画面に出す短い文言）。警告を組み立てる処理は、どんな値でも例外を投げない */
import { MAX_DATE_MS } from '../../lib/time/timezone';
import { formatJstLabeled } from '../../lib/time/dateTimeFormat';
import { detailPreview } from '../../lib/text/textPreview';
import { formatNumber } from '../../lib/number';

/** UNIX時間ツールと同じく、13桁以上の整数はミリ秒で書かれたものとみなす */
const MIN_MILLIS_EPOCH = 1e12;

/** 秒のはずの時刻がミリ秒で書かれていれば、その警告。exp は秒として読むと遠い未来になり「有効期限内」に見える。元の表記は小数の桁に制限がないため、抜粋にする */
export function millisWarning(name: string, epoch: number, text: string): string | null {
  if (Math.abs(epoch) < MIN_MILLIS_EPOCH || Math.abs(epoch) > MAX_DATE_MS) return null;
  return `${name}（${detailPreview(text)}）はミリ秒で書かれている可能性があります。JWT の時刻は秒で書くため、多くの検証側は遠い未来の日時として読みます。ミリ秒として読むと ${formatJstLabeled(new Date(epoch))} です`;
}

/**
 * ヘッダの危険な指定の警告。
 *
 * @remarks
 * 重さ（tone）を文言と別に持つ。画面が文言の先頭で重さを決めると、文言を直しただけで重大な警告が普通の警告に変わるため。
 * `bad` は、そのまま受け付けると誰でも改ざんできる指定（alg: none）だけに使う。
 */
export type HeaderWarning = { tone: 'bad' | 'warn'; message: string };

/** ヘッダの危険な指定の警告（RFC 8725 JWT のベストプラクティス） */
export function headerWarnings(header: Record<string, unknown>): HeaderWarning[] {
  const w: HeaderWarning[] = [];
  const warn = (message: string) => w.push({ tone: 'warn', message });
  if (typeof header.alg === 'string' && header.alg.toLowerCase() === 'none') {
    w.push({ tone: 'bad', message: 'alg が none（署名なし）です。誰でも内容を書き換えられるため、受け付けてはいけません' });
  }
  for (const k of ['jku', 'x5u'] as const) {
    if (k in header) {
      warn(`ヘッダに ${k}（鍵を取得する URL）があります。検証する側は、この URL から取得した鍵を信用せず、あらかじめ決めた鍵だけで検証してください`);
    }
  }
  for (const k of ['jwk', 'x5c'] as const) {
    if (k in header) warn(`ヘッダに鍵（${k}）が埋め込まれています。トークン自身に含まれる鍵で検証しても、正しい発行者が署名したことにはなりません`);
  }
  if ('crit' in header) {
    const names = Array.isArray(header.crit) ? listOf(header.crit) : describeValue(header.crit);
    warn(`crit（${names}）があります。挙げられた拡張を理解できない検証側は、このトークンを拒否する必要があります`);
  }
  if ('b64' in header && header.b64 !== true) {
    warn(`b64 が ${describeValue(header.b64)} です。b64 が false なら、ペイロードは Base64URL をデコードしない文字列そのものを意味します（RFC 7797）。ここに表示したペイロードは、標準の読み方でデコードしたものです`);
  }
  return w;
}

export const TIME_CLAIMS = ['auth_time', 'iat', 'nbf', 'exp'] as const;

/** RFC 7519 の NumericDate（1970年からの秒数）として使える値か。1e999 のように Infinity になる値は使えない */
export const isNumericDate = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * 警告に入れる値の短い説明。任意の値でも例外を投げない。
 *
 * @remarks
 * JSON.stringify や String は、深い入れ子（RangeError）や toString・valueOf が文字列を返さないオブジェクト（TypeError）で
 * 例外を投げ、デコードの結果全体を表示できなくなるため使わない。長い文字列は先頭だけを示す
 */
function describeValue(v: unknown): string {
  if (typeof v === 'string') {
    let shown = '', count = 0;
    for (const char of v) {
      if (count++ === 40) return JSON.stringify(shown + '…');
      shown += char;
    }
    return JSON.stringify(v);
  }
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `配列（要素${formatNumber(v.length)}個）`;
  return 'オブジェクト';
}

/** 名前の一覧を、先頭10件までつなぐ。名前はトークン由来で長さに制限がないため、1件ずつ抜粋にする */
const listOf = (names: unknown[]): string => {
  const shown = names.slice(0, 10).map((name) => detailPreview(typeof name === 'string' ? name : describeValue(name))).join(', ');
  return names.length > 10 ? `${shown} ほか${formatNumber(names.length - 10)}件` : shown;
};

/** 時刻のクレームが数値でない（文字列・null・真偽値・有限でない数）ときの警告 */
export function timeClaimTypeWarnings(payload: Record<string, unknown>): string[] {
  return TIME_CLAIMS.filter((k) => k in payload && !isNumericDate(payload[k])).map((k) =>
    `${k} が ${typeof payload[k] === 'number' ? '有限の数ではありません' : `数値ではありません（${describeValue(payload[k])}）`}。RFC 7519 では日時のクレームは数値（NumericDate）です。検証する側によって、期限切れ・不正・期限なしのどれにも扱われるおそれがあります`);
}
