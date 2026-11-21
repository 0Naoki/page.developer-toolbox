import { decodeJwe, parseJwt, type ParsedJwt } from './logic';
import { isNumericDate } from './diagnostics';

/** 画面が使うヘッダと期限の値だけを持つ。深いJSONオブジェクトをWorkerから転送しない。全文はJSONの文字列で保つ。 */
export type JwtDisplay = Omit<ParsedJwt, 'header' | 'payload'> & {
  header: { alg?: string; kid?: string };
  payload: { exp?: number | null; nbf?: number | null };
  warningTotal: number;
};

export type TokenCalculation = { kind: 'jwt'; data: JwtDisplay } | { kind: 'jwe'; headerJson: string } | null;

/** 現在時刻に依存しないトークンの解析。警告は先頭5件と総数にし、コピー・検証用の文字列は全文を返す。 */
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
      warnings: warnings.slice(0, 5), warningTotal: warnings.length,
    },
  };
}
