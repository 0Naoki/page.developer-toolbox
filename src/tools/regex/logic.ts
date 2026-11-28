import { errorMessage } from '../../lib/errors';
import { detailPreview } from '../../lib/text/textPreview';
import type { SettingValidator } from '../../lib/settings';

/** 画面で選べるフラグ（d は一致の位置を得るため、計算のときに付ける） */
const SELECTABLE_FLAGS = 'gimsuy';

/**
 * 保存したフラグの検証。選べるフラグだけからなり、重複がない文字列だけを受け付ける。
 * 空文字は、すべてのフラグを外した状態として有効にする。
 * 文字列なら何でも受け付けると、"invalid" のような値から i だけを拾い、既定の g に戻らなくなる
 */
export const isStoredFlags: SettingValidator<string> = (value): value is string =>
  typeof value === 'string' && value.length <= SELECTABLE_FLAGS.length &&
  [...value].every((c) => SELECTABLE_FLAGS.includes(c)) && new Set(value).size === value.length;

export const MAX_TEXT = 100_000;
export const MAX_PATTERN = 10_000;
export const MAX_MATCHES = 500;
export const MAX_OUTPUT = 1_000_000;
export const MAX_GROUPS = 50;
/** 表示の上限を超えた後に置換を続ける時間（画面側の2秒の打ち切りより短くする） */
const TIME_BUDGET_MS = 1000;

export type RegexInput = { pattern: string; flags: string; text: string; replacement: string };
export type Capture = { label: string; value: string | null; start: number | null; end: number | null };
export type Match = { value: string; start: number; end: number; captures: Capture[] };
export type RegexResult =
  | { ok: false; error: string }
  /** matches は先頭 MAX_MATCHES 件。total は全件数で、数え終わらなかったときは null */
  | { ok: true; matches: Match[]; truncated: boolean; total: number | null; output: string | null; replacementError: string | null };

/** 置換文字列を解析した部品。文字列はそのまま出力する */
type Part = string | { kind: '$' | '&' | '`' | "'" } | { kind: 'number'; digits: string } | { kind: 'name'; name: string };

const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';

/**
 * String.replace と同じ置換記法を解析する。名前付きキャプチャがなければ $\< は通常の文字で、
 * その中の $1・$$ などは引き続き展開する。
 * 閉じる \> のない $\< が出てくるたびに末尾まで探し直すと計算量が2乗になるため、最後の \> の位置を先に求め、
 * それより後ろの $\< では探さない（\> があれば、そこまでを名前として読み進めるので、探し直しは起きない）
 */
function parseReplacement(template: string, named: boolean): Part[] {
  const parts: Part[] = [];
  const lastClose = named ? template.lastIndexOf('>') : -1;
  let from = 0;
  let i = template.indexOf('$');
  while (i >= 0 && i + 1 < template.length) {
    const c = template[i + 1];
    let part: Part | null = null;
    let end = i + 2;
    if (c === '$' || c === '&' || c === '`' || c === "'") part = { kind: c };
    else if (isDigit(c)) {
      if (isDigit(template[i + 2])) end = i + 3;
      part = { kind: 'number', digits: template.slice(i + 1, end) };
    } else if (c === '<' && lastClose > i + 1) {
      const close = template.indexOf('>', i + 2);
      part = { kind: 'name', name: template.slice(i + 2, close) };
      end = close + 1;
    }
    if (!part) {
      i = template.indexOf('$', i + 1);
      continue;
    }
    if (i > from) parts.push(template.slice(from, i));
    parts.push(part);
    from = end;
    i = template.indexOf('$', end);
  }
  if (from < template.length) parts.push(template.slice(from));
  return parts;
}

/** 解析した置換記法を、マッチごとに展開する。出力の膨張は組み立て中に止める。 */
function appendSubstitution(parts: Part[], match: RegExpExecArray, text: string, append: (piece: string) => void): void {
  for (const part of parts) {
    if (typeof part === 'string') append(part);
    else if (part.kind === 'name') append(match.groups?.[part.name] ?? '');
    else if (part.kind === 'number') {
      /** $nn がキャプチャの数を超えるときは、$n と後ろの1文字として読む（String.replace と同じ） */
      const { digits } = part;
      const n = Number(digits);
      const first = Number(digits[0]);
      if (n > 0 && n < match.length) append(match[n] ?? '');
      else if (digits.length === 2 && first > 0 && first < match.length) append((match[first] ?? '') + digits[1]);
      else append('$' + digits);
    } else if (part.kind === '$') append('$');
    else if (part.kind === '&') append(match[0]);
    else if (part.kind === '`') append(text.slice(0, match.index));
    else append(text.slice(match.index + match[0].length));
  }
}

/** 画面からの転送前と Worker 内で、同じ入力上限を確かめる。 */
export function validateRegexInputSize({ pattern, text, replacement }: RegexInput): void {
  if (pattern.length > MAX_PATTERN) throw new Error(`正規表現は${MAX_PATTERN / 10_000}万文字までです`);
  if (text.length > MAX_TEXT) throw new Error(`テスト文字列は${MAX_TEXT / 10_000}万文字までです`);
  if (replacement.length > MAX_TEXT) throw new Error(`置換文字列は${MAX_TEXT / 10_000}万文字までです`);
}

/**
 * 正規表現を作る。書き方の誤りは、理由を先に、パターンは抜粋にした文言の例外にする。
 *
 * @remarks
 * Chromium のエラーは「Invalid regular expression: /パターン全文/フラグ: 理由」の形で、パターンが長いと、
 * 表示の上限（limitMessage）で末尾の理由が切れて見えなくなる。ブラウザによってはパターンを含まないため、
 * 決まった形のときだけ理由を取り出し、それ以外もパターンの全文は抜粋に置き換える。
 */
function compileRegex(pattern: string, flags: string): RegExp {
  try {
    return new RegExp(pattern, flags);
  } catch (e) {
    const message = errorMessage(e);
    /** フラグの並び順はエンジンが並べ直すことがあるため、パターンの後ろの「フラグ: 」までを読み飛ばす */
    const prefix = `Invalid regular expression: /${pattern}/`;
    const afterFlags = message.startsWith(prefix) ? /^[a-z]*: /.exec(message.slice(prefix.length)) : null;
    const reason = afterFlags
      ? message.slice(prefix.length + afterFlags[0].length)
      : pattern !== '' && message.includes(pattern) ? message.split(pattern).join(detailPreview(pattern)) : message;
    throw new Error(`正規表現の書き方に誤りがあります：${detailPreview(reason)}（正規表現：${detailPreview(pattern)}）`);
  }
}

/** 時間のかかる式に備え、画面からは Worker 内で呼ぶ。 */
export function evaluateRegex(input: RegexInput, timeBudgetMs = TIME_BUDGET_MS): RegexResult {
  try {
    validateRegexInputSize(input);
    const { pattern, flags, text, replacement } = input;
    if (!/^[dgimsuy]*$/.test(flags)) throw new Error('使用できるフラグは d・g・i・m・s・u・y です');
    /** d により、未参加のキャプチャと空文字のキャプチャを区別し、位置も取得する。 */
    const regex = compileRegex(pattern, flags.includes('d') ? flags : flags + 'd');
    const matches: Match[] = [];
    const output: string[] = [];
    let outputLength = 0;
    let resultLength = 0;
    let previousEnd = 0;
    let total = 0;
    let replacementError: string | null = null;
    const started = performance.now();
    /** 置換文字列は、最初のマッチで名前付きキャプチャの有無がわかったときに1回だけ解析する */
    let parts: Part[] | null = null;
    const append = (piece: string) => {
      if (piece === '') return;
      outputLength += piece.length;
      if (outputLength > MAX_OUTPUT) throw new Error(`置換結果が大きすぎます（${MAX_OUTPUT / 10_000}万文字まで）`);
      output.push(piece);
    };
    for (;;) {
      const match = regex.exec(text);
      if (!match) break;
      const listed = matches.length < MAX_MATCHES;
      /** 表示の上限を超えた後は置換だけを続ける。遅い式でも、画面側の打ち切りより先に表示分を返す */
      if (!listed && performance.now() - started > timeBudgetMs) {
        return { ok: true, matches, truncated: true, total: null, output: null, replacementError: replacementError ?? `マッチが多く時間がかかるため、置換結果を省略しました（先頭${MAX_MATCHES}件を表示）` };
      }
      if (match.length - 1 > MAX_GROUPS) throw new Error(`キャプチャグループは${MAX_GROUPS}個までです`);
      total++;
      if (listed) {
        const capture = (label: string, value: string | undefined, range: [number, number] | undefined): Capture => {
          resultLength += value?.length ?? 0;
          return { label, value: value ?? null, start: range?.[0] ?? null, end: range?.[1] ?? null };
        };
        const captures = match.slice(1).map((value, i) => capture(`$${i + 1}`, value, match.indices?.[i + 1]));
        for (const [name, value] of Object.entries(match.groups ?? {})) {
          captures.push(capture(`$<${name}>`, value, match.indices?.groups?.[name]));
        }
        resultLength += match[0].length;
        if (resultLength > MAX_OUTPUT) throw new Error(`マッチとキャプチャの合計が大きすぎます（${MAX_OUTPUT / 10_000}万文字まで）`);
        matches.push({ value: match[0], start: match.index, end: match.index + match[0].length, captures });
      }
      if (!replacementError) {
        try {
          append(text.slice(previousEnd, match.index));
          parts ??= parseReplacement(replacement, match.groups !== undefined);
          appendSubstitution(parts, match, text, append);
        } catch (e) {
          replacementError = errorMessage(e);
        }
      }
      previousEnd = match.index + match[0].length;
      if (!regex.global) break;
      /** exec は空のマッチで進まない。u のときはサロゲートペアをまとめて進める。 */
      if (match[0] === '') {
        const cp = text.codePointAt(regex.lastIndex);
        regex.lastIndex += regex.unicode && cp !== undefined && cp > 0xffff ? 2 : 1;
      }
    }
    if (!replacementError) {
      try {
        append(text.slice(previousEnd));
      } catch (e) {
        replacementError = errorMessage(e);
      }
    }
    return { ok: true, matches, truncated: total > matches.length, total, output: replacementError ? null : output.join(''), replacementError };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
