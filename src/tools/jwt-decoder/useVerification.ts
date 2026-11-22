import { useMemo, useState } from 'react';
import { useAsyncFor } from '../../hooks/useAsyncFor';
import { usePreference } from '../../hooks/usePreference';
import { oneOf } from '../../lib/settings';
import { errorMessage } from '../../lib/errors';
import type { SignatureVerification } from '../../lib/crypto/signature';
import type { JwtDisplay } from './calculation';
import { isHmacAlg } from './alg';
import { readPublicKey, secretBytes, shortSecretWarning, type SecretEncoding } from './keys';
import { prepareJws, type PreparedJws } from './jws';
import { verifyPreparedJws, type VerifyKey } from './verify';

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
type VerifyTarget = { key: VerifyKey; jws: PreparedJws; alg: string | undefined };

/** 検証に使うトークンの値。jwsProblem は Worker で確かめた結果 */
type VerifyToken = Pick<JwtDisplay, 'header' | 'signingInput' | 'signature' | 'jwsProblem'>;

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
 * data が null の間は検証を止め、鍵の入力は保持する。Worker解析中の旧トークンを検証しないため。
 * 検証に使うバイト列はトークンごとに1回だけ作り、鍵を変えたときはトークン全体を読み直さない（巨大なトークンで画面が止まらないように）。
 */
export function useVerification(data: VerifyToken | null): VerificationState {
  const [keyText, setKeyText] = useState('');
  const [encoding, setEncoding] = usePreference<SecretEncoding>('jwt:secret-encoding', 'utf-8', oneOf('utf-8', 'base64'));
  /** alg・kidがオブジェクトのときは検証に使わず、再計算の判断も文字列の値だけで行う。 */
  const alg = typeof data?.header.alg === 'string' ? data.header.alg : undefined;
  const kid = typeof data?.header.kid === 'string' ? data.header.kid : undefined;
  const hmac = isHmacAlg(alg);

  const key = useMemo((): LoadedKey => {
    /** UTF-8のHMAC鍵では空白も鍵のバイト列。公開鍵とBase64入力だけは空白のみを未入力とする。 */
    const empty = hmac && encoding === 'utf-8' ? keyText === '' : keyText.trim() === '';
    if (empty) return NO_KEY;
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

  const signingInput = data?.signingInput;
  const signature = data?.signature;
  const problem = data?.jwsProblem;
  const jws = useMemo(() => (signingInput === undefined || signature === undefined || problem === undefined ? null : prepareJws(signingInput, signature, problem)), [signingInput, signature, problem]);
  const target = useMemo((): VerifyTarget | null => (jws && key.key ? { key: key.key, jws, alg } : null), [key, jws, alg]);
  const verified = useAsyncFor(
    target,
    (t) => verifyPreparedJws(t.jws, t.alg, t.key),
    (error): SignatureVerification => ({ status: 'unsupported', message: errorMessage(error) }),
  );
  const result = verified.ready ? verified.value : null;

  return { keyText, setKeyText, encoding, setEncoding, keyError: key.error, keyWarning: key.warning, keySource: key.source, result };
}
