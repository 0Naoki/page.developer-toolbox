/**
 * JWTデコーダーのプロパティテスト（fast-check で入力を生成し、どの入力でも成り立つ性質を確かめる）。
 * 個別の入力の期待値は logic.test.ts にある。失敗したときは、表示された seed と path を fc.assert の引数に足すと同じ入力で再現できる。
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseJwt } from './logic';

/** UTF-8 の Base64URL（パディングなし） */
function base64Url(text: string): string {
  const binary = Array.from(new TextEncoder().encode(text), (b) => String.fromCharCode(b)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** JSON のオブジェクト（ヘッダ・ペイロード）。exp・iat などの時刻クレームと、日本語・絵文字のキーを含めて作る */
const objectArb = fc.oneof(
  fc.dictionary(fc.string({ unit: 'grapheme', maxLength: 6 }), fc.jsonValue({ maxDepth: 3 }), { maxKeys: 6 }),
  fc.record({ alg: fc.constantFrom('HS256', 'RS256', 'none'), exp: fc.oneof(fc.integer(), fc.double(), fc.string()), iat: fc.integer({ min: 0, max: 4_102_444_800 }) }, { requiredKeys: [] }),
);
const signatureArb = fc.stringMatching(/^[A-Za-z0-9_-]{0,20}$/);

describe('parseJwt', () => {
  it('Base64URL にしたヘッダ・ペイロードを、元の JSON と同じ値に読み、署名と署名の対象を変えない', () => {
    fc.assert(
      fc.property(objectArb, objectArb, signatureArb, fc.constantFrom('', 'Bearer ', '  '), (header, payload, signature, prefix) => {
        const headerText = JSON.stringify(header);
        const payloadText = JSON.stringify(payload);
        const signingInput = `${base64Url(headerText)}.${base64Url(payloadText)}`;
        const parsed = parseJwt(`${prefix}${signingInput}.${signature}\n`);
        expect(parsed.header).toEqual(JSON.parse(headerText));
        expect(parsed.payload).toEqual(JSON.parse(payloadText));
        /** 表示用の JSON も、読み直すと同じ値になる（整形で値を変えない） */
        expect(JSON.parse(parsed.headerJson)).toEqual(JSON.parse(headerText));
        expect(JSON.parse(parsed.payloadJson)).toEqual(JSON.parse(payloadText));
        expect(parsed.signature).toBe(signature);
        expect(parsed.signingInput).toBe(signingInput);
        /** 時刻クレームは、有限の数のときだけ日時にする */
        for (const claim of parsed.timeClaims) expect(Number.isFinite(claim.epoch)).toBe(true);
      }),
    );
  });

  it('どんな文字列でも、例外を投げるなら画面に出せる文言付きの Error にする', () => {
    const part = fc.oneof(fc.string({ maxLength: 12 }), fc.stringMatching(/^[A-Za-z0-9_-]{0,16}$/), fc.jsonValue().map((v) => base64Url(JSON.stringify(v) ?? '')));
    const tokenArb = fc.oneof(fc.string(), fc.array(part, { minLength: 1, maxLength: 6 }).map((parts) => parts.join('.')));
    fc.assert(
      fc.property(tokenArb, (token) => {
        try {
          parseJwt(token);
        } catch (e) {
          expect((e as Error).constructor).toBe(Error);
          expect((e as Error).message).not.toBe('');
        }
      }),
    );
  });
});
