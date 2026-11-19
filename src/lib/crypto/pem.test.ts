import { describe, expect, it } from 'vitest';
import { bytesToBase64 } from '../bytes';
import { INVALID_BASE64_PADDING, VALID_BASE64_PADDING } from '../bytes.fixtures';
import { PEM_UNMATCHED, pemBodyToBytes, readPemBlocks } from './pem';

const ANY = { checkType: () => {}, maxBlocks: 10, tooMany: '多すぎます' };
const block = (type: string, body: string) => `-----BEGIN ${type}-----\n${body}\n-----END ${type}-----`;
const BYTES = new Uint8Array([0x30, 0x03, 0x02, 0x01, 0x05, 0xfb, 0xff]);
const BODY = bytesToBase64(BYTES);

describe('pemBodyToBytes', () => {
  it.each(VALID_BASE64_PADDING)('PEMも正常なパディングと完全省略を読む：%s', (input, expected) => {
    expect(new TextDecoder().decode(pemBodyToBytes(input))).toBe(expected);
    expect(new TextDecoder().decode(readPemBlocks(block('PUBLIC KEY', input), ANY)[0]!.der)).toBe(expected);
  });

  it.each(INVALID_BASE64_PADDING)('PEMの不正なパディングを拒否する：%s', (input) => {
    expect(() => pemBodyToBytes(input)).toThrow('Base64');
    expect(() => readPemBlocks(block('PUBLIC KEY', input), ANY)).toThrow('Base64');
  });

  it('標準の Base64 を、空白・改行を無視して読む', () => {
    expect([...pemBodyToBytes(`${BODY.slice(0, 4)}\n ${BODY.slice(4)}\r\n`)]).toEqual([...BYTES]);
  });

  it('Base64URL の記号（- と _）や「-----」は、標準の Base64 でないとして断る', () => {
    expect(BODY).toMatch(/[+/]/);
    const url = BODY.replace(/\+/g, '-').replace(/\//g, '_');
    expect(() => pemBodyToBytes(url)).toThrow('Base64 として読めない文字があります');
    expect(() => pemBodyToBytes('-----')).toThrow('Base64 として読めない文字があります');
  });

  it('文字数が正しくない Base64 は、atob の英語の例外ではなく日本語で伝える', () => {
    expect(() => pemBodyToBytes('MIIBA')).toThrow('Base64 として読めません（文字数が正しくありません');
  });
});

describe('readPemBlocks', () => {
  it('ブロックを順にすべて読み、ブロックの外の文字とヘッダー行（: を含む行）は読み飛ばす', () => {
    const text = `subject=CN = a\n${block('CERTIFICATE', `Proc-Type: 4,ENCRYPTED\n${BODY}`)}\nissuer=CN = b\n${block('PUBLIC KEY', BODY)}`;
    const blocks = readPemBlocks(text, ANY);
    expect(blocks.map((b) => b.type)).toEqual(['CERTIFICATE', 'PUBLIC KEY']);
    for (const b of blocks) expect([...b.der]).toEqual([...BYTES]);
  });

  it('1行にまとめた PEM も読む', () => {
    expect([...readPemBlocks(block('PUBLIC KEY', BODY).replace(/\n/g, ' '), ANY)[0]!.der]).toEqual([...BYTES]);
  });

  it('BEGIN がなければ空の配列を返し、ブロックとして読めない BEGIN だけがあれば断る', () => {
    expect(readPemBlocks(BODY, ANY)).toEqual([]);
    expect(() => readPemBlocks(`-----BEGIN\n${BODY}`, ANY)).toThrow(PEM_UNMATCHED);
    expect(() => readPemBlocks(`-----BEGIN XYZ\n${BODY}`, ANY)).toThrow(PEM_UNMATCHED);
    expect(() => readPemBlocks(`-----BEGIN PUBLIC KEY-----\n${BODY}`, ANY)).toThrow(PEM_UNMATCHED);
    expect(() => readPemBlocks(`${block('PUBLIC KEY', BODY)}\n-----BEGIN PUBLIC KEY-----\n${BODY}`, ANY)).toThrow(PEM_UNMATCHED);
  });

  it('種類の確認と上限は、本文を読む前に行う（本文が壊れていても、種類・個数の理由を伝える）', () => {
    const reject = (type: string) => { if (type !== 'CERTIFICATE') throw new Error(`「${type}」は読みません`); };
    expect(() => readPemBlocks(block('PUBLIC KEY', '壊れた本文'), { ...ANY, checkType: reject })).toThrow('「PUBLIC KEY」は読みません');
    const two = `${block('CERTIFICATE', BODY)}\n${block('CERTIFICATE', '壊れた本文')}`;
    expect(() => readPemBlocks(two, { ...ANY, maxBlocks: 1 })).toThrow('多すぎます');
    expect(readPemBlocks(block('CERTIFICATE', BODY), { ...ANY, maxBlocks: 1 })).toHaveLength(1);
  });

  it('閉じていない BEGIN が多い大きな入力でも、すぐにエラーを返す（画面を固めない）', () => {
    const many = '-----BEGIN CERTIFICATE-----\n'.repeat(20000) + 'A'.repeat(200000);
    const start = performance.now();
    expect(() => readPemBlocks(many, ANY)).toThrow(PEM_UNMATCHED);
    expect(performance.now() - start).toBeLessThan(200);
  });
});
