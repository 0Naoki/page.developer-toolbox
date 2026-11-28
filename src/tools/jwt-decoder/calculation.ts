import { decodeJwe, parseJwt, type ParsedJwt } from './logic';
import { isNumericDate } from './diagnostics';
import { jwsProblem } from './jws';

/**
 * 画面が使うヘッダと期限の値だけを持つ。深いJSONオブジェクトをWorkerから転送しない。全文はJSONの文字列で保つ。
 * jwsProblem は、署名の検証に使う厳密な読み取りの結果。鍵に依存せず、全文の読み直しで重いため、Workerで1回だけ行う。
 */
export type JwtDisplay = Omit<ParsedJwt, 'header' | 'payload'> & {
  header: { alg?: string; kid?: string };
  payload: { exp?: number | null; nbf?: number | null };
  warningTotal: number;
  jwsProblem: string | null;
};

/** 画面へ返す警告の件数（残りは総数だけ。重複したキーの警告などは多くなり得るため） */
export const WARNINGS_SHOWN = 5;

export type TokenCalculation = { kind: 'jwt'; data: JwtDisplay } | { kind: 'jwe'; headerJson: string } | null;

/** 現在時刻に依存しないトークンの解析。警告は先頭 {@link WARNINGS_SHOWN} 件と総数にし、コピー・検証用の文字列は全文を返す。 */
export function decodeTokenForScreen(input: string): TokenCalculation {
  if (!input.trim()) return null;
  const jwe = decodeJwe(input);
  if (jwe) return { kind: 'jwe', headerJson: jwe.headerJson };
  const parsed = parseJwt(input);
  const { header, payload, warnings, ...display } = parsed;
  const timeValue = (value: unknown) => value === undefined ? undefined : isNumericDate(value) ? value : null;
  return {
    kind: 'jwt',
    data: {
      ...display,
      header: { alg: typeof header.alg === 'string' ? header.alg : undefined, kid: typeof header.kid === 'string' ? header.kid : undefined },
      payload: { exp: timeValue(payload.exp), nbf: timeValue(payload.nbf) },
      warnings: warnings.slice(0, WARNINGS_SHOWN), warningTotal: warnings.length,
      jwsProblem: jwsProblem(display.signingInput, display.signature),
    },
  };
}
