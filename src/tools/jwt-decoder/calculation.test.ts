import { describe, expect, it } from 'vitest';
import { decodeTokenForScreen } from './calculation';
import { judgeJwt } from './logic';
import { base64Url } from './tokens.fixtures';

const tokenWith = (payload: string) => `${base64Url('{"alg":"HS256"}')}.${base64Url(payload)}.c2ln`;

describe('Workerから返すトークン', () => {
  it('深いJSONを転送せず、全文と不正な期限・期限なしの違いを保つ', () => {
    const text = '{"sub":' + '['.repeat(1000) + '1' + ']'.repeat(1000) + ',"exp":"wrong"}';
    const response = structuredClone(decodeTokenForScreen(tokenWith(text)));
    expect(response?.kind).toBe('jwt');
    if (response?.kind !== 'jwt') throw new Error('JWTを読めません');
    expect(response.data.payload).toEqual({ exp: null, nbf: undefined });
    expect(response.data.payloadJson).toBe(text);
    expect(judgeJwt(response.data, 0)).toMatchObject({ expired: 'invalid', notYetValid: null });
  });
  it('警告は先頭5件と総数にし、期限は現在時刻で判定できる', () => {
    const response = decodeTokenForScreen(tokenWith('{"a":0,' + '"a":1,'.repeat(10) + '"exp":1,"nbf":2}'));
    if (response?.kind !== 'jwt') throw new Error('JWTを読めません');
    expect(response.data.warnings).toHaveLength(5);
    expect(response.data.warningTotal).toBe(10);
    expect(judgeJwt(response.data, 1000)).toMatchObject({ expired: true, notYetValid: true });
  });
  it('空入力とJWEも同じ要求で扱う', () => {
    expect(decodeTokenForScreen(' ')).toBeNull();
    const response = decodeTokenForScreen('eyJhbGciOiJkaXIifQ.key.iv.cipher.tag');
    expect(response).toEqual({ kind: 'jwe', headerJson: '{\n  "alg": "dir"\n}' });
  });
});
