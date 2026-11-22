/**
 * 署名の検証に使う JWS の部分（「ヘッダ.ペイロード」と署名）の厳密な読み取り。
 * 鍵に依存しないため、トークンごとに1回だけ行う。重い確認（ペイロード全文の Base64URL の読み直し）は Worker で行い、
 * 鍵を変えるたびに画面の処理で繰り返さない。
 */
import { base64ToBytes, bytesToBase64 } from '../../lib/bytes';
import { isRecord } from '../../lib/settings';

/**
 * JWS の Base64URL（RFC 7515）を読む。base64ToBytes は緩いため、空白・パディング・標準の Base64 の記号や、
 * 余りのビットだけが違う書き換えも同じバイト列になる。読み直して元の文字列に戻るものだけを受け付ける
 */
function jwsBytes(part: string): Uint8Array<ArrayBuffer> {
  const bytes = base64ToBytes(part);
  if (part === '' || bytesToBase64(bytes, { urlSafe: true }) !== part) throw new Error('Base64URL の形式ではありません');
  return bytes;
}

const B64_PROBLEM = 'ヘッダの b64 が true 以外です。ペイロードを Base64URL にしない形式（RFC 7797）には対応していないため、このトークンは無効です';

/**
 * 署名の対象（「ヘッダ.ペイロード」）が JWS として無効なら、その理由を返す。
 * 表示用のデコードは緩く読むため、検証ではここで Base64URL と UTF-8 を厳密に確かめる。
 * crit に挙げられた拡張を理解できない JWS は無効で（RFC 7515 4.1.11）、このツールは拡張を実装していないため、crit があれば拒否する。
 * b64 が true 以外（RFC 7797）なら、ペイロードは Base64URL をデコードしない文字列そのものを意味する。標準の読み方で検証すると、
 * 別の内容のペイロードを「正しい」と表示するため、crit がなくても拒否する（RFC 7797 では、b64 を使うなら crit にも書く必要がある）
 */
function signingInputProblem(signingInput: string): string | null {
  const [head = '', payload = ''] = signingInput.split('.');
  let header: unknown;
  try {
    const bytes = jwsBytes(head);
    jwsBytes(payload);
    header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return 'ヘッダまたはペイロードを Base64URL として読めません';
  }
  if (!isRecord(header)) return null;
  if ('crit' in header) return 'ヘッダの crit に挙げられた拡張に対応していないため、このトークンは無効です';
  if ('b64' in header && header.b64 !== true) return B64_PROBLEM;
  return null;
}

/**
 * 署名・署名の対象が JWS として無効なら、その理由を返す（署名の部分を先に確かめる）。
 *
 * @param signingInput - Base64URL 表記のままの「ヘッダ.ペイロード」。
 * @param signature - Base64URL 表記の署名部分。
 * @returns 無効な理由。JWS として読めるなら null。
 */
export function jwsProblem(signingInput: string, signature: string): string | null {
  try {
    jwsBytes(signature);
  } catch {
    return '署名の部分を Base64URL として読めません';
  }
  return signingInputProblem(signingInput);
}

/** 検証の準備ができた JWS。problem が null のときだけ、data・signature を検証に使う */
export type PreparedJws = { problem: string | null; data: Uint8Array<ArrayBuffer>; signature: Uint8Array<ArrayBuffer> };

/**
 * 検証に使うバイト列を作る。鍵に依存しないため、トークンごとに1回だけ呼ぶ。
 *
 * @param signingInput - Base64URL 表記のままの「ヘッダ.ペイロード」。
 * @param signature - Base64URL 表記の署名部分。
 * @param problem - {@link jwsProblem} の結果。Worker で確かめた結果を渡すと、画面の処理で確かめ直さない。
 */
export function prepareJws(signingInput: string, signature: string, problem = jwsProblem(signingInput, signature)): PreparedJws {
  if (problem !== null) return { problem, data: new Uint8Array(0), signature: new Uint8Array(0) };
  return { problem: null, data: new TextEncoder().encode(signingInput), signature: base64ToBytes(signature) };
}
