import { useMemo, useState } from 'react';
import { useAsyncFor } from '../../hooks/useAsyncFor';
import { usePreference } from '../../hooks/usePreference';
import { oneOf } from '../../lib/settings';
import { errorMessage } from '../../lib/errors';
import type { SignatureVerification } from '../../lib/crypto/signature';
import type { ParsedJwt } from './logic';
import { isHmacAlg } from './alg';
import { readPublicKey, secretBytes, shortSecretWarning, type SecretEncoding } from './keys';
import { verifyJwt, type VerifyKey } from './verify';

/** 署名の検証の欄の状態。鍵の入力と、読み込み・検証の結果 */
export type VerificationState = {
  /** 入力された鍵（秘密鍵・公開鍵）。保存しない */
  keyText: string;
  setKeyText: (v: string) => void;
  encoding: SecretEncoding;
  setEncoding: (v: SecretEncoding) => void;
  /** 鍵の読み込みのエラー */
  keyError: string;
  /** 鍵についての警告（秘密鍵が短いなど） */
  keyWarning: string | null;
  /** 検証に使った鍵の説明 */
  keySource: string;
  result: SignatureVerification | null;
};

/** 署名の検証の対象。結果と一緒に持ち、今の入力に対する結果かを確かめる */
type VerifyTarget = { key: VerifyKey; signingInput: string; signature: string; alg: string | undefined };

/** 読み込んだ鍵と、読み込みのエラー・警告 */
type LoadedKey = { key: VerifyKey | null; error: string; warning: string | null; source: string };

const NO_KEY: LoadedKey = { key: null, error: '', warning: null, source: '' };

/**
 * 鍵の入力を受け取り、トークンの署名を検証する。
 *
 * @remarks
 * 鍵は機密情報になり得るため、useState で持ち、保存しない（秘密鍵の形式の選択だけを表示設定として保存する）。
 * 鍵の読み込みは描画中に行うため、例外はここで受け止めて keyError にする。
 * 検証の結果は、どの鍵・トークンの結果かを組で持ち（useAsyncFor）、入力を変えた直後の描画でも前の結果を表示しない。
 */
export function useVerification(data: ParsedJwt): VerificationState {
  const [keyText, setKeyText] = useState('');
  const [encoding, setEncoding] = usePreference<SecretEncoding>('jwt:secret-encoding', 'utf-8', oneOf('utf-8', 'base64'));
  /**
   * 現在時刻の更新で data は毎秒作り直されるため、検証のやり直しの判断には文字列にした値を使う
   * （alg や kid がオブジェクトのトークンで、毎秒検証し直して表示がちらつかないように）
   */
  const alg = typeof data.header.alg === 'string' ? data.header.alg : undefined;
  const kid = typeof data.header.kid === 'string' ? data.header.kid : undefined;
  const hmac = isHmacAlg(alg);

  const key = useMemo((): LoadedKey => {
    if (!keyText.trim()) return NO_KEY;
    try {
      if (hmac) {
        const bytes = secretBytes(keyText, encoding);
        return { key: { kind: 'secret', bytes }, error: '', warning: shortSecretWarning(alg, bytes), source: '' };
      }
      const pub = readPublicKey(keyText, kid, alg);
      return { key: { kind: 'public', key: pub }, error: '', warning: null, source: pub.source };
    } catch (e) {
      return { ...NO_KEY, error: errorMessage(e) };
    }
  }, [keyText, encoding, hmac, alg, kid]);

  const target = useMemo((): VerifyTarget | null => (key.key ? { key: key.key, signingInput: data.signingInput, signature: data.signature, alg } : null), [key, data.signingInput, data.signature, alg]);
  const verified = useAsyncFor(
    target,
    (t) => verifyJwt(t.signingInput, t.signature, t.alg, t.key),
    (error): SignatureVerification => ({ status: 'unsupported', message: errorMessage(error) }),
  );
  const result = verified.ready ? verified.value : null;

  return { keyText, setKeyText, encoding, setEncoding, keyError: key.error, keyWarning: key.warning, keySource: key.source, result };
}
