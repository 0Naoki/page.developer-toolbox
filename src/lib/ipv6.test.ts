import { describe, expect, it } from 'vitest';
import { formatIpv6Groups } from './ipv6';

describe('formatIpv6Groups', () => {
  it('推奨の表記（RFC 5952）：小文字・先頭の0を省く・最も長い0の並びを :: にする', () => {
    expect(formatIpv6Groups([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1])).toBe('2001:db8::1');
    expect(formatIpv6Groups([0, 0, 0, 0, 0, 0, 0, 0])).toBe('::');
    expect(formatIpv6Groups([0, 0, 0, 0, 0, 0, 0, 1])).toBe('::1');
    expect(formatIpv6Groups([0xfe80, 0, 0, 0, 0, 0, 0, 0])).toBe('fe80::');
    expect(formatIpv6Groups([0xabcd, 0xef, 1, 2, 3, 4, 5, 6])).toBe('abcd:ef:1:2:3:4:5:6');
  });

  it('0 が1グループだけなら省略せず、同じ長さの並びは先頭を省略する', () => {
    expect(formatIpv6Groups([0x2001, 0xdb8, 0, 1, 1, 1, 1, 1])).toBe('2001:db8:0:1:1:1:1:1');
    expect(formatIpv6Groups([0x2001, 0, 0, 1, 0, 0, 0, 1])).toBe('2001:0:0:1::1');
    expect(formatIpv6Groups([0x2001, 0xdb8, 0, 0, 1, 0, 0, 1])).toBe('2001:db8::1:0:0:1');
  });

  it('IPv4 射影アドレスは末尾を IPv4 の形で書く。射影でないアドレスは16進数のまま', () => {
    expect(formatIpv6Groups([0, 0, 0, 0, 0, 0xffff, 0xc000, 0x201])).toBe('::ffff:192.0.2.1');
    expect(formatIpv6Groups([0, 0, 0, 0, 0, 0xffff, 0, 0])).toBe('::ffff:0.0.0.0');
    /** IPv4 互換（::c000:201）・NAT64（64:ff9b::/96）は射影ではない */
    expect(formatIpv6Groups([0, 0, 0, 0, 0, 0, 0xc000, 0x201])).toBe('::c000:201');
    expect(formatIpv6Groups([0x64, 0xff9b, 0, 0, 0, 0, 0xc000, 0x221])).toBe('64:ff9b::c000:221');
  });

  it('グループが8つでなければ例外にする', () => {
    expect(() => formatIpv6Groups([0, 0, 0, 0, 0, 0, 0])).toThrow('グループが8つ');
  });
});
