import { describe, expect, it } from 'vitest';
import { bytesToBase64 } from '../../lib/bytes';
import { ED25519, LEAF, ROOT_CA } from '../cert/certificates.fixtures';
import { LEAF_JWK, P384_JWK, P521_PUBLIC_PEM, RSA_JWK, RSA_PUBLIC_PEM, RSA_PUBLIC_PKCS1_PEM, SECRET, SECRET_BASE64, TOKENS, base64Url, decodeJwt } from './tokens.fixtures';
import { readPublicKey, secretBytes, shortSecretWarning } from './keys';
import { INVALID_BASE64_PADDING, VALID_BASE64_PADDING } from '../../lib/bytes.fixtures';
import { verifyJwt, type VerifyKey } from './verify';
import { SAMPLE_SECRET, SAMPLE_TOKEN } from './sample';
import { limitMessage, MESSAGE_LIMIT } from '../../lib/text/textPreview';

/** トークンの署名を、ヘッダの alg で検証する */
const verify = (token: string, key: VerifyKey, subtle?: SubtleCrypto) => {
  const d = decodeJwt(token, 0);
  return verifyJwt(d.signingInput, d.signature, d.header.alg, key, subtle);
};
const secret = (s: string, encoding: 'utf-8' | 'base64' = 'utf-8'): VerifyKey => ({ kind: 'secret', bytes: secretBytes(s, encoding) });
const pub = (text: string, token?: string): VerifyKey => ({ kind: 'public', key: readPublicKey(text, token && decodeJwt(token, 0).header.kid) });

it('長いJWKのalg・use・crvでも、表示上限内に検証できない理由を残す', async () => {
  for (const [field, reason] of [['alg', '異なります'], ['use', '署名用（sig）ではありません'], ['crv', '必要な鍵（RSA）と合いません']] as const) {
    const jwk = field === 'crv' ? { kty: 'EC', crv: 'x'.repeat(2000), x: 'AQ', y: 'AQ' } : { ...RSA_JWK, [field]: 'x'.repeat(2000) };
    const result = await verify(TOKENS.RS256, pub(JSON.stringify(jwk)));
    expect(result.status).toBe('invalid');
    expect(result.message.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
    expect(limitMessage(result.message)).toContain(reason);
  }
});

/** ペイロードを別の内容（管理者の権限を足したもの）に書き換えた（改ざんした）トークン */
const tampered = (token: string) => {
  const [h, , s] = token.split('.');
  const p = base64Url('{"sub":"1234567890","name":"test","admin":true}');
  return `${h}.${p}.${s}`;
};

describe('verifyJwt：HMAC（HS256 など）', () => {
  it('正しい秘密鍵なら一致する', async () => {
    expect(await verify(TOKENS.HS256, secret(SECRET))).toEqual({ status: 'valid', message: '署名は正しく、この秘密鍵で作られています' });
    expect(await verify(TOKENS.HS512, secret(SECRET))).toMatchObject({ status: 'valid' });
  });

  it('Base64 で入力した秘密鍵でも検証できる', async () => {
    expect(await verify(TOKENS.HS256_B64, secret(SECRET_BASE64, 'base64'))).toMatchObject({ status: 'valid' });
    /** UTF-8 として読むと別の鍵になる */
    expect(await verify(TOKENS.HS256_B64, secret(SECRET_BASE64))).toMatchObject({ status: 'invalid' });
  });

  it('秘密鍵が違うか、内容が書き換えられていると一致しない', async () => {
    expect(await verify(TOKENS.HS256, secret('wrong-secret-wrong-secret-wrong-secret'))).toMatchObject({ status: 'invalid', message: expect.stringContaining('一致しません') });
    expect(await verify(tampered(TOKENS.HS256), secret(SECRET))).toMatchObject({ status: 'invalid' });
  });

  it('空の秘密鍵は検証しない', async () => {
    expect(await verify(TOKENS.HS256, secret(''))).toEqual({ status: 'invalid', message: '秘密鍵が空です' });
  });

  it('短すぎる秘密鍵を警告する（RFC 7518：ハッシュと同じ長さ以上）', async () => {
    expect(await verify(TOKENS.HS256_SHORT, secret('secret'))).toMatchObject({ status: 'valid' });
    expect(shortSecretWarning('HS256', secretBytes('secret', 'utf-8'))).toContain('6 バイトで、HS256 に必要な 32 バイト');
    expect(shortSecretWarning('HS512', secretBytes(SECRET, 'utf-8'))).toContain('64 バイト');
    expect(shortSecretWarning('HS256', secretBytes(SECRET, 'utf-8'))).toBeNull();
    expect(shortSecretWarning('RS256', new Uint8Array())).toBeNull();
  });

  it('Base64 として読めない秘密鍵は、日本語のエラーにする', () => {
    expect(() => secretBytes('abc$', 'base64')).toThrow('秘密鍵を Base64 として読めません');
  });

  it.each(VALID_BASE64_PADDING)('Base64のHMAC鍵は有効なパディングと完全省略を読む：%s', (input, expected) => {
    expect(new TextDecoder().decode(secretBytes(input, 'base64'))).toBe(expected);
  });

  it.each(INVALID_BASE64_PADDING)('Base64のHMAC鍵の不正なパディングを拒否する：%s', (input) => {
    expect(() => secretBytes(input, 'base64')).toThrow('秘密鍵を Base64 として読めません');
  });

  it('UTF-8 の秘密鍵に対になっていないサロゲートがあれば、U+FFFD に置き換えて検証しない', () => {
    expect(() => secretBytes('secret\uD800', 'utf-8')).toThrow('秘密鍵の7 文字目（U+D800）が対になっていないサロゲート');
    expect(new TextDecoder().decode(secretBytes('𠮷', 'utf-8'))).toBe('𠮷');
  });
});

describe('secretBytes：公開鍵や秘密鍵を HMAC の鍵にしない', () => {
  const singleLine = RSA_PUBLIC_PEM.replace(/\r?\n/g, ' ');

  it('公開鍵（PEM・証明書・JWK・JWK Set）は、どちらの形式でも受け付けない', () => {
    for (const text of [RSA_PUBLIC_PEM, `  ${RSA_PUBLIC_PEM.trim()}  `, singleLine, RSA_PUBLIC_PKCS1_PEM, LEAF, JSON.stringify(RSA_JWK), JSON.stringify({ keys: [RSA_JWK] })]) {
      for (const encoding of ['utf-8', 'base64'] as const) {
        expect(() => secretBytes(text, encoding)).toThrow('公開鍵を HMAC の鍵にすると');
      }
    }
  });

  it('秘密鍵は、貼り付けないよう伝える', () => {
    for (const text of ['-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----', JSON.stringify({ ...RSA_JWK, d: 'AAAA' }), JSON.stringify({ keys: [{ ...RSA_JWK, d: 'AAAA' }] })]) {
      expect(() => secretBytes(text, 'utf-8')).toThrow('秘密鍵が含まれています');
    }
  });

  it('共通鍵の JWK は、k の値を入力するよう伝える', () => {
    expect(() => secretBytes(JSON.stringify({ kty: 'oct', k: 'AAAA' }), 'utf-8')).toThrow('k の値を Base64 として入力');
  });

  it('Base64 で包んだ公開鍵・PEM の本文・Base64 の JWK も、Base64 の秘密鍵として受け付けない', () => {
    const pemBody = RSA_PUBLIC_PEM.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
    const wrapped = (text: string) => bytesToBase64(new TextEncoder().encode(text));
    for (const text of [wrapped(RSA_PUBLIC_PEM), wrapped(LEAF), wrapped(JSON.stringify(RSA_JWK)), pemBody]) {
      expect(() => secretBytes(text, 'base64')).toThrow('公開鍵を HMAC の鍵にすると');
    }
    /** PKCS#8 の外側の形（INTEGER・SEQUENCE・OCTET STRING）の DER */
    const pkcs8 = bytesToBase64(new Uint8Array([0x30, 0x0b, 0x02, 0x01, 0x00, 0x30, 0x03, 0x06, 0x01, 0x2a, 0x04, 0x01, 0x00]));
    expect(() => secretBytes(pkcs8, 'base64')).toThrow('秘密鍵が含まれています');
    expect(() => secretBytes(wrapped('-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----'), 'base64')).toThrow('秘密鍵が含まれています');
  });

  it('Base64 の共通鍵（テキストでも乱数でも）は、そのまま使う', () => {
    expect(new TextDecoder().decode(secretBytes(SECRET_BASE64, 'base64'))).toBe('0123456789abcdef0123456789abcdef');
    const random = new Uint8Array(32).map((_, i) => (i * 73 + 41) & 0xff);
    expect([...secretBytes(bytesToBase64(random), 'base64')]).toEqual([...random]);
  });

  it('鍵の形式でない文字列は、そのまま秘密鍵として使う', () => {
    for (const text of ['my private key', 'BEGIN PUBLIC KEY', '{"not":"a key"}', '{broken', '{"keys":[1]}']) {
      expect(new TextDecoder().decode(secretBytes(text, 'utf-8'))).toBe(text);
    }
  });
});

describe('verifyJwt：署名は Base64URL（RFC 7515）だけを受け付ける', () => {
  const [signingHead = '', signingBody = '', signature = ''] = TOKENS.HS256.split('.');
  const verifySignature = (value: string, token = `${signingHead}.${signingBody}`) =>
    verifyJwt(token, value, 'HS256', secret(SECRET));

  it('元の署名は一致する', async () => {
    expect(await verifySignature(signature)).toMatchObject({ status: 'valid' });
  });

  it('デコードすると同じバイト列になる書き換えを受け付けない', async () => {
    for (const changed of [
      `${signature}=`,
      `${signature.slice(0, 10)} ${signature.slice(10)}`,
      /** 32バイトの署名の末尾の文字は、下位2ビットが余り。k（100100）と l（100101）は同じバイト列になる */
      signature.replace(/k$/, 'l'),
    ]) {
      expect(changed).not.toBe(signature);
      expect(await verifySignature(changed)).toMatchObject({ status: 'invalid', message: expect.stringContaining('Base64URL') });
    }
  });

  it('標準の Base64 の記号（+ と /）を受け付けない', async () => {
    const [head = '', body = '', value = ''] = TOKENS.HS512.split('.');
    expect(value).toMatch(/[-_]/);
    const standard = value.replace(/-/g, '+').replace(/_/g, '/');
    expect(await verifyJwt(`${head}.${body}`, value, 'HS512', secret(SECRET))).toMatchObject({ status: 'valid' });
    expect(await verifyJwt(`${head}.${body}`, standard, 'HS512', secret(SECRET))).toMatchObject({ status: 'invalid', message: expect.stringContaining('Base64URL') });
  });

  describe('ヘッダとペイロードも厳密に読む', () => {
    const encode = base64Url;
    /** 文字列 signingInput に、正しい鍵で HS256 の署名を付けて検証する */
    const signed = async (signingInput: string) => {
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const value = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));
      return verifySignature(bytesToBase64(new Uint8Array(value), { urlSafe: true }), signingInput);
    };

    it('署名し直した正しい形のトークンは一致する', async () => {
      expect(await signed(`${signingHead}.${signingBody}`)).toMatchObject({ status: 'valid' });
    });

    it('パディング・空白・標準の Base64 の記号を受け付けない', async () => {
      const standard = encode('{"alg":"HS256","x":"???>>>"}');
      expect(standard).toMatch(/[-_]/);
      for (const input of [
        `${signingHead}=.${signingBody}`,
        `${signingHead}.${signingBody}=`,
        `${signingHead.slice(0, 4)} ${signingHead.slice(4)}.${signingBody}`,
        `${standard.replace(/-/g, '+').replace(/_/g, '/')}.${signingBody}`,
      ]) {
        expect(await signed(input), input).toMatchObject({ status: 'invalid', message: expect.stringContaining('Base64URL') });
      }
    });

    it('未対応の必須拡張（crit）があるトークンは、署名が正しくても無効', async () => {
      for (const header of ['{"alg":"HS256","crit":["unsupported"],"unsupported":true}', '{"alg":"HS256","crit":"unsupported"}', '{"alg":"HS256","crit":[]}']) {
        expect(await signed(`${encode(header)}.${signingBody}`), header).toMatchObject({ status: 'invalid', message: expect.stringContaining('crit') });
      }
    });
  });

  it('空の署名は検証しない', async () => {
    expect(await verifySignature('')).toMatchObject({ status: 'invalid', message: expect.stringContaining('Base64URL') });
  });
});

describe('verifyJwt：公開鍵（RS・PS・ES・EdDSA）', () => {
  it('RS256・PS256：PEM の公開鍵と JWK で検証する', async () => {
    expect(await verify(TOKENS.RS256, pub(RSA_PUBLIC_PEM))).toMatchObject({ status: 'valid' });
    expect(await verify(TOKENS.RS256, pub(JSON.stringify(RSA_JWK)))).toMatchObject({ status: 'valid' });
    expect(await verify(TOKENS.PS256, pub(RSA_PUBLIC_PEM))).toMatchObject({ status: 'valid' });
  });

  it('ES256：証明書（PEM）と JWK で検証する', async () => {
    expect(await verify(TOKENS.ES256, pub(LEAF))).toMatchObject({ status: 'valid' });
    expect(await verify(TOKENS.ES256, pub(JSON.stringify(LEAF_JWK)))).toMatchObject({ status: 'valid' });
  });

  it('ES384（JWK Set から kid で選ぶ）・ES512（P-521）・EdDSA（Ed25519 の証明書）', async () => {
    const jwks = JSON.stringify({ keys: [RSA_JWK, P384_JWK] });
    expect(await verify(TOKENS.ES384, pub(jwks, TOKENS.ES384))).toMatchObject({ status: 'valid' });
    expect(await verify(TOKENS.ES512, pub(P521_PUBLIC_PEM))).toMatchObject({ status: 'valid' });
    expect(await verify(TOKENS.EDDSA, pub(ED25519))).toMatchObject({ status: 'valid' });
  });

  it('内容が書き換えられていると一致しない', async () => {
    expect(await verify(tampered(TOKENS.RS256), pub(RSA_PUBLIC_PEM))).toMatchObject({ status: 'invalid', message: expect.stringContaining('一致しません') });
    expect(await verify(tampered(TOKENS.ES256), pub(LEAF))).toMatchObject({ status: 'invalid' });
    expect(await verify(tampered(TOKENS.EDDSA), pub(ED25519))).toMatchObject({ status: 'invalid' });
  });

  it('鍵の種類が alg と合わなければ検証しない', async () => {
    expect(await verify(TOKENS.RS256, pub(LEAF))).toEqual({
      status: 'invalid',
      message: '鍵の種類（P-256）が、トークンの alg（RS256）に必要な鍵（RSA）と合いません',
    });
    expect(await verify(TOKENS.ES384, pub(LEAF))).toMatchObject({ status: 'invalid', message: expect.stringContaining('（P-384）') });
  });

  it('JWK の alg・use が、トークンと合わなければ検証しない', async () => {
    /** RSA_JWK は alg: RS256 の鍵 */
    expect(await verify(TOKENS.PS256, pub(JSON.stringify(RSA_JWK)))).toMatchObject({
      status: 'invalid',
      message: '鍵に指定された alg（RS256）が、トークンの alg（PS256）と異なります',
    });
    expect(await verify(TOKENS.ES256, pub(JSON.stringify({ ...LEAF_JWK, use: 'enc' })))).toMatchObject({ status: 'invalid', message: expect.stringContaining('use: enc') });
    expect(await verify(TOKENS.ES256, pub(JSON.stringify({ ...LEAF_JWK, key_ops: ['verify'] })))).toMatchObject({ status: 'valid' });
    for (const key_ops of [['encrypt'], []]) {
      expect(await verify(TOKENS.ES256, pub(JSON.stringify({ ...LEAF_JWK, key_ops }))), String(key_ops)).toMatchObject({ status: 'invalid', message: expect.stringContaining('key_ops') });
    }
  });

  it('JWK の alg・use・key_ops の型が不正なら、鍵として読まない（RFC 7517）', () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ alg: ['PS256'] }, 'JWK の alg が文字列ではありません（["PS256"]）'],
      [{ use: ['enc'] }, 'JWK の use が文字列ではありません（["enc"]）'],
      [{ key_ops: ['verify', 123, 'verify'] }, 'JWK の key_ops は、重複のない文字列の配列で指定してください'],
      [{ key_ops: ['verify', 'verify'] }, 'JWK の key_ops は、重複のない文字列の配列で指定してください'],
      [{ key_ops: 'verify' }, 'JWK の key_ops は、重複のない文字列の配列で指定してください'],
    ];
    for (const [extra, message] of cases) {
      expect(() => readPublicKey(JSON.stringify({ ...RSA_JWK, ...extra })), JSON.stringify(extra)).toThrow(message);
      expect(() => readPublicKey(JSON.stringify({ keys: [{ ...RSA_JWK, ...extra }] }), 'rsa-1', 'RS256'), JSON.stringify(extra)).toThrow(message);
    }
  });

  it('長い kid や JWK の値は、エラーに抜粋だけを入れる', () => {
    const kid = 'k'.repeat(1_000_000);
    expect(() => readPublicKey(JSON.stringify({ keys: [RSA_JWK] }), kid, 'RS256')).toThrow(/^トークンの kid「k{255}…」に一致する鍵が/);
    /** 鍵の入力の上限（64 KiB）以内で、エラーに埋め込むと長くなる値 */
    const alg = Array(20_000).fill(1);
    let message = '';
    try { readPublicKey(JSON.stringify({ ...RSA_JWK, alg })); } catch (e) { message = (e as Error).message; }
    expect(message).toMatch(/^JWK の alg が文字列ではありません（\[1,1,.*…）$/);
    expect(message.length).toBeLessThan(300);
  });

  it('長い kid・alg は、鍵を決められないエラーと鍵の説明に抜粋だけを入れる', () => {
    /** kid は JWK Set にも書くため、鍵の入力の上限（64 KiB）に収まる長さにする。alg はトークンのヘッダ由来で上限がない */
    const kid = 'k'.repeat(20_000);
    const alg = 'A'.repeat(1_000_000);
    const keys = [{ ...RSA_JWK, kid }, { ...P384_JWK, kid }];
    let message = '';
    try { readPublicKey(JSON.stringify({ keys }), kid, alg); } catch (e) { message = (e as Error).message; }
    /** 未知の alg では鍵の種類で絞れず、同じ kid の2つの鍵から決められない */
    expect(message).toBe(`JWK Set に、kid「${'k'.repeat(255)}…」と alg（${'A'.repeat(255)}…）に合う鍵が複数あるため、どの鍵で検証するか決められません`);
    expect(readPublicKey(JSON.stringify({ keys: [{ ...RSA_JWK, kid }] }), kid, 'RS256').source).toBe(`JWK Set の kid「${'k'.repeat(255)}…」の鍵`);
  });

  it('JWK Set の同じ kid の鍵は、並び順ではなく alg に合う種類で選ぶ（RFC 7517 4.5）', async () => {
    const ec = { ...P384_JWK, kid: 'rsa-1' };
    const alg = 'RS256';
    for (const keys of [[ec, RSA_JWK], [RSA_JWK, ec]]) {
      const key = readPublicKey(JSON.stringify({ keys }), 'rsa-1', alg);
      expect(await verify(TOKENS.RS256, { kind: 'public', key })).toMatchObject({ status: 'valid' });
    }
    /** 合う鍵がない・複数あるときは、署名の不一致ではなく、鍵を決められないことを伝える */
    expect(() => readPublicKey(JSON.stringify({ keys: [ec, { ...P384_JWK, kid: 'rsa-1', x: 'AAAA' }] }), 'rsa-1', 'RS256')).toThrow('kid「rsa-1」と alg（RS256）に合う鍵がありません');
    expect(() => readPublicKey(JSON.stringify({ keys: [RSA_JWK, { ...RSA_JWK }] }), 'rsa-1', 'RS256')).toThrow('合う鍵が複数ある');
    /** kid がなくても、alg に合う鍵が1つだけなら選ぶ */
    const { kid: _kid, ...noKid } = RSA_JWK;
    void _kid;
    expect(readPublicKey(JSON.stringify({ keys: [P384_JWK, noKid] }), undefined, 'RS256')).toMatchObject({ format: 'jwk', jwk: { kty: 'RSA' } });
  });

  it('ECDSA の署名が DER 形式（よくある誤り）なら、長さが合わないと伝える', async () => {
    expect(await verify(TOKENS.ES256_DER, pub(LEAF))).toMatchObject({ status: 'invalid', message: expect.stringContaining('DER ではなく r と s を並べた形式') });
  });

  it('アルゴリズムの取り違え：HS256 を公開鍵で、RS256 を秘密鍵で検証させない', async () => {
    expect(await verify(TOKENS.HS256, pub(RSA_PUBLIC_PEM))).toMatchObject({ status: 'invalid', message: expect.stringContaining('公開鍵では検証できません') });
    expect(await verify(TOKENS.RS256, secret(SECRET))).toMatchObject({ status: 'invalid', message: 'RS256 は公開鍵で検証します' });
  });

  it('Ed25519 に対応していないブラウザでは「対応していない」と返す', async () => {
    const subtle = {
      importKey: () => Promise.reject(Object.assign(new Error('unsupported'), { name: 'NotSupportedError' })),
    } as unknown as SubtleCrypto;
    expect(await verify(TOKENS.EDDSA, pub(ED25519), subtle)).toMatchObject({ status: 'unsupported', message: expect.stringContaining('Ed25519') });
  });

  it('回帰：公開鍵を読み込めないときは「一致しない」でなく「検証できない」と返す（証明書デコーダーと同じ扱い）', async () => {
    /** 鍵の読み込みの失敗を invalid にしていたため、画面に「署名が一致しない」のバッジが出ていた */
    const subtle = {
      importKey: () => Promise.reject(new DOMException('壊れた鍵', 'DataError')),
    } as unknown as SubtleCrypto;
    expect(await verify(TOKENS.RS256, pub(RSA_PUBLIC_PEM), subtle)).toEqual({ status: 'unsupported', message: '公開鍵を読み込めません（DataError）' });
    /** Ed25519 でも、未対応（NotSupportedError）以外の失敗は「ブラウザが対応していない」とは言わない */
    expect(await verify(TOKENS.EDDSA, pub(ED25519), subtle)).toEqual({ status: 'unsupported', message: '公開鍵を読み込めません（DataError）' });
  });

  it('secp256k1 の鍵は「一致しない」でなく「検証できない」と返す', async () => {
    const k1 = JSON.stringify({ kty: 'EC', crv: 'secp256k1', x: 'AA', y: 'AA' });
    expect(await verify(TOKENS.ES256, pub(k1))).toMatchObject({ status: 'unsupported', message: expect.stringContaining('secp256k1') });
  });
});

describe('verifyJwt：対応していない alg', () => {
  const withAlg = (alg: string) => verifyJwt('a.b', 'c2ln', alg, secret(SECRET));
  it('none・ES256K・未知の alg', async () => {
    expect(await withAlg('none')).toMatchObject({ status: 'unsupported', message: expect.stringContaining('none（署名なし）') });
    expect(await withAlg('ES256K')).toMatchObject({ status: 'unsupported', message: expect.stringContaining('secp256k1') });
    expect(await withAlg('XX999')).toMatchObject({ status: 'unsupported', message: 'この署名アルゴリズム（XX999）には対応していません' });
    /** alg はトークン由来で長さに制限がないため、文言には抜粋だけを入れる */
    expect(await withAlg('X'.repeat(1_000_000))).toMatchObject({ status: 'unsupported', message: `この署名アルゴリズム（${'X'.repeat(255)}…）には対応していません` });
    expect(await verifyJwt('a.b', 'c2ln', undefined, secret(SECRET))).toMatchObject({ status: 'unsupported', message: expect.stringContaining('alg') });
  });
});

describe('readPublicKey', () => {
  it('kid・alg で選ばれない鍵も、秘密鍵の値があれば入力全体を拒否する', () => {
    for (const privateKey of [
      { ...P384_JWK, kid: 'other', d: 'AAAA' },
      { ...P384_JWK, kid: 'rsa-1', d: 'AAAA' },
      { kty: 'oct', kid: 'other', k: 'AAAA' },
    ]) {
      for (const keys of [[RSA_JWK, privateKey], [privateKey, RSA_JWK]]) {
        expect(() => readPublicKey(JSON.stringify({ keys }), 'rsa-1', 'RS256')).toThrow(/秘密鍵|共通鍵/);
      }
    }
  });

  it('どの形式で読んだかを返す', () => {
    expect(readPublicKey(RSA_PUBLIC_PEM).source).toBe('公開鍵（PEM）');
    expect(readPublicKey(LEAF).source).toBe('証明書「www.example.test」の公開鍵');
    expect(readPublicKey(JSON.stringify(RSA_JWK)).source).toBe('公開鍵（JWK）');
    expect(readPublicKey(JSON.stringify({ keys: [P384_JWK] })).source).toBe('JWK Set の鍵');
  });

  it('秘密鍵は読まない', () => {
    expect(() => readPublicKey('-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----')).toThrow('秘密鍵が含まれています');
    expect(() => readPublicKey(JSON.stringify({ ...LEAF_JWK, d: 'AAAA' }))).toThrow('秘密鍵の値（d など）');
    expect(() => readPublicKey(JSON.stringify({ kty: 'oct', k: 'AAAA' }))).toThrow('共通鍵');
  });

  it('空の JWK Set は、鍵がないと伝える', () => {
    expect(() => readPublicKey('{"keys":[]}')).toThrow('JWK Set に鍵がありません');
  });

  it('JWK Set で kid から鍵を決められなければエラー', () => {
    const jwks = JSON.stringify({ keys: [RSA_JWK, P384_JWK] });
    expect(() => readPublicKey(jwks, 'nothing')).toThrow('kid「nothing」に一致する鍵');
    expect(() => readPublicKey(jwks)).toThrow('どの鍵で検証するか決められません');
  });

  it('対応していない形式は、変換の方法か対応形式を伝える', () => {
    expect(() => readPublicKey(RSA_PUBLIC_PKCS1_PEM)).toThrow('openssl rsa -RSAPublicKey_in -pubout');
    expect(() => readPublicKey('hello')).toThrow('対応している形式は');
    expect(() => readPublicKey('{"kty":')).toThrow('JWK として読めません');
    expect(() => readPublicKey('-----BEGIN PUBLIC KEY-----\nAAAA')).toThrow('BEGIN と -----END の組');
    expect(() => readPublicKey('-----BEGIN EC PARAMETERS-----\nBggqhkjOPQMBBw==\n-----END EC PARAMETERS-----')).toThrow('「EC PARAMETERS」には対応していません。対応している形式は');
  });

  it('PEM は証明書デコーダーと同じ厳しさで読む（ブロックの外の文字は読み飛ばし、Base64URL の記号は断る）', () => {
    expect(readPublicKey(`subject=CN = www.example.test\n${LEAF}`).source).toBe('証明書「www.example.test」の公開鍵');
    const body = RSA_PUBLIC_PEM.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
    expect(body).toMatch(/[+/]/);
    const url = body.replace(/\+/g, '-').replace(/\//g, '_');
    expect(() => readPublicKey(`-----BEGIN PUBLIC KEY-----\n${url}\n-----END PUBLIC KEY-----`)).toThrow('Base64 として読めない文字があります');
  });

  it('証明書のチェーンなど複数の PEM は、どれで検証するか決められないため断る（先頭を黙って使わない）', () => {
    for (const text of [`${LEAF}\n${ROOT_CA}`, `${RSA_PUBLIC_PEM}\n${LEAF}`]) {
      expect(() => readPublicKey(text)).toThrow('PEM のブロックが複数あります');
    }
  });
});

describe('verifyJwt：b64（RFC 7797）', () => {
  /** 標準の読み方（ペイロードを Base64URL にする）で HS256 の署名を作る */
  const sign = async (header: Record<string, unknown>) => {
    const encode = (value: unknown) => base64Url(JSON.stringify(value));
    const input = `${encode(header)}.${encode({ admin: true })}`;
    const key = await crypto.subtle.importKey('raw', secretBytes(SECRET, 'utf-8'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input))));
    return verifyJwt(input, signature, 'HS256', secret(SECRET));
  };

  it('b64 が true 以外なら、crit がなくても検証せずに無効とする', async () => {
    for (const b64 of [false, 'no', 0, null]) {
      expect(await sign({ alg: 'HS256', b64 })).toMatchObject({ status: 'invalid', message: expect.stringContaining('b64 が true 以外です') });
    }
  });

  it('b64 が true（既定と同じ）か、ないときは検証する', async () => {
    expect(await sign({ alg: 'HS256', b64: true })).toMatchObject({ status: 'valid' });
    expect(await sign({ alg: 'HS256' })).toMatchObject({ status: 'valid' });
  });
});

describe('サンプルのトークン', () => {
  it('テスト用の TOKENS.HS256・SECRET と同じで、サンプルの秘密鍵で署名を確かめられる', async () => {
    expect(SAMPLE_TOKEN).toBe(TOKENS.HS256);
    expect(SAMPLE_SECRET).toBe(SECRET);
    expect(await verify(SAMPLE_TOKEN, secret(SAMPLE_SECRET))).toMatchObject({ status: 'valid' });
  });
});
