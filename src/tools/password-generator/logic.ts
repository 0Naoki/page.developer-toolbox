import { cryptoRng, type Rng as RandomFill } from '../../lib/random';
import { isBoolean, isRecord, isString, integerBetween } from '../../lib/settings';

/** 乱数源。テストで差し替えられるように引数で受け取る */
export type Rng = RandomFill<Uint32Array<ArrayBuffer>>;

export const CHARSETS = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  symbols: '!#$%&()*+-./:;<=>?@[]^_{|}~',
} as const;

/** 見間違えやすい文字 */
export const AMBIGUOUS = 'Il1|O0o`\'"';

export type PasswordOptions = {
  length: number;
  upper: boolean;
  lower: boolean;
  digits: boolean;
  symbols: boolean;
  /** 使用する記号（空なら CHARSETS.symbols） */
  symbolSet: string;
  excludeAmbiguous: boolean;
  /** 個別に除外したい文字 */
  exclude: string;
  /** 選んだ文字種をそれぞれ最低1文字含める */
  requireEach: boolean;
};

export const DEFAULT_OPTIONS: PasswordOptions = {
  length: 16,
  upper: true,
  lower: true,
  digits: true,
  symbols: true,
  symbolSet: CHARSETS.symbols,
  excludeAmbiguous: true,
  exclude: '',
  requireEach: true,
};

export const MIN_LENGTH = 4;
export const MAX_LENGTH = 128;

/** 保存設定は型だけでなく、実際に生成できる組み合わせかも確かめる。 */
export function isPasswordOptions(value: unknown): value is PasswordOptions {
  if (!isRecord(value) || !integerBetween(MIN_LENGTH, MAX_LENGTH)(value.length) ||
      !isString(value.symbolSet) || !isString(value.exclude) ||
      !['upper', 'lower', 'digits', 'symbols', 'excludeAmbiguous', 'requireEach'].every((key) => isBoolean(value[key]))) return false;
  return validate(value as PasswordOptions) === null;
}

/**
 * 0 以上 max 未満の整数を偏りなく返す。
 * 単純な剰余（% max）は値に偏りが出るため、範囲外の値を捨てて引き直す（棄却サンプリング）。
 */
export function randomInt(max: number, rng: Rng = cryptoRng): number {
  if (!Number.isInteger(max) || max <= 0 || max > 2 ** 32) throw new Error('max が不正です');
  const limit = 2 ** 32 - (2 ** 32 % max);
  const buf = new Uint32Array(1);
  for (;;) {
    rng(buf);
    const value = buf[0] ?? limit;
    if (value < limit) return value % max;
  }
}

const unique = (s: string) => [...new Set(s)].join('');

/** 選んだ文字種ごとの文字集合。除外で空になった集合も、必須条件の検査に使うため残す */
function selectedPools(o: PasswordOptions): string[] {
  const excluded = new Set(o.exclude + (o.excludeAmbiguous ? AMBIGUOUS : ''));
  const filter = (s: string) => [...unique(s)].filter((c) => !excluded.has(c)).join('');
  const pools: string[] = [];
  if (o.upper) pools.push(filter(CHARSETS.upper));
  if (o.lower) pools.push(filter(CHARSETS.lower));
  if (o.digits) pools.push(filter(CHARSETS.digits));
  if (o.symbols) pools.push(filter(o.symbolSet || CHARSETS.symbols));
  return pools;
}

/** オプションから使用できる文字種ごとの文字集合を作る（除外文字を反映済み） */
export function buildPools(o: PasswordOptions): string[] {
  return selectedPools(o).filter((p) => p.length > 0);
}

/** 設定の問題点を返す。問題なければ null */
export function validate(o: PasswordOptions): string | null {
  return validatePools(o, selectedPools(o));
}

/** 用意した文字集合を使って、長さと必須の文字種の条件を確かめる。 */
function validatePools(o: PasswordOptions, selected: string[]): string | null {
  if (!Number.isInteger(o.length) || o.length < MIN_LENGTH || o.length > MAX_LENGTH) {
    return `長さは${MIN_LENGTH}〜${MAX_LENGTH}文字で指定してください`;
  }
  const pools = selected.filter((p) => p.length > 0);
  if (pools.length === 0) return '使用できる文字がありません。文字種を1つ以上選んでください';
  if (o.requireEach && selected.some((p) => p.length === 0)) {
    return '必須の文字種に使用できる文字がありません。除外設定を見直すか、その文字種の選択を外してください';
  }
  if (o.requireEach && pools.length > o.length) return '長さが選んだ文字種の数より短くなっています';
  return null;
}

/** パスワードを1つ生成する */
export function generatePassword(o: PasswordOptions, rng: Rng = cryptoRng): string {
  return preparePassword(o)(rng);
}

/** 文字集合の検証とコードポイントへの分割を1回だけ行い、一括生成で共有する。乱数や生成結果は共有しない。 */
function preparePassword(o: PasswordOptions): (rng: Rng) => string {
  const selected = selectedPools(o);
  const error = validatePools(o, selected);
  if (error) throw new Error(error);

  /**
   * 文字列の添字（UTF-16 の単位）で選ぶと、絵文字などの片割れだけを選んで壊れた文字になるため、
   * 1文字（コードポイント）ずつの配列にしてから選ぶ
   */
  const pools = selected.filter((p) => p.length > 0).map((p) => Array.from(p));
  const all = Array.from(unique(pools.flat().join('')));
  return (rng) => {
    /** randomInt は 0 以上 s.length 未満を返す（?? '' は型のためだけ） */
    const pick = (s: string[]) => s[randomInt(s.length, rng)] ?? '';
    const chars: string[] = [];
    if (o.requireEach) for (const p of pools) chars.push(pick(p));
    while (chars.length < o.length) chars.push(pick(all));
    /** 必須文字が先頭に固まらないようにシャッフル（Fisher–Yates） */
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomInt(i + 1, rng);
      const a = chars[i] ?? '';
      chars[i] = chars[j] ?? '';
      chars[j] = a;
    }
    return chars.join('');
  };
}

export function generateMany(o: PasswordOptions, count: number, rng: Rng = cryptoRng): string[] {
  if (count <= 0) return [];
  const generate = preparePassword(o);
  return Array.from({ length: count }, () => generate(rng));
}

/** PIN（数字のみ）を生成する */
export function generatePin(length: number, rng: Rng = cryptoRng): string {
  if (!Number.isInteger(length) || length < 4 || length > 32) throw new Error('PINの桁数は4〜32で指定してください');
  return Array.from({ length }, () => String(randomInt(10, rng))).join('');
}

/** エントロピー（ビット）の目安 = 長さ × log2(文字の種類数) */
export function entropyBits(o: PasswordOptions): number {
  const size = Array.from(unique(buildPools(o).join(''))).length;
  return size > 0 ? o.length * Math.log2(size) : 0;
}

/** PIN のエントロピー（ビット）の目安 = 桁数 × log2(10)。パスワードと同じ式で、文字の種類数は数字の10 */
export const pinEntropyBits = (length: number): number => length * Math.log2(10);

export type Strength = { level: 0 | 1 | 2 | 3; label: string };

export function strengthOf(bits: number): Strength {
  if (bits < 40) return { level: 0, label: '弱い' };
  if (bits < 60) return { level: 1, label: '普通' };
  if (bits < 80) return { level: 2, label: '強い' };
  return { level: 3, label: '非常に強い' };
}
