import { expect, it } from 'vitest';
import { parseDerExact } from '../../lib/crypto/asn1';
import { readExtensions } from './extensions';

it('未知の拡張の生バイトを表示用の抜粋と別に保持する', () => {
  const bytes = Array.from({ length: 40 }, (_, i) => i);
  const payload = [6, 2, 42, 3, 4, bytes.length, ...bytes];
  const der = new Uint8Array([48, payload.length + 2, 48, payload.length, ...payload]);
  const ext = readExtensions(parseDerExact(der)).extensions[0]!;
  expect(ext.raw).toEqual(new Uint8Array(bytes));
  expect(ext.values[0]).toContain('…');
  expect(ext.raw.buffer).toBe(der.buffer);
});
