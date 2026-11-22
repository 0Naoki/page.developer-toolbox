/**
 * IPアドレス・サブネット計算のプロパティテスト（fast-check で入力を生成し、どの入力でも成り立つ性質を確かめる）。
 * 個別の入力の期待値は ipv4.test.ts・ipv6.test.ts にある。失敗したときは、表示された seed と path を fc.assert の引数に足すと同じ入力で再現できる。
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { aggregate, formatIpv4, parseCidrList, parseIpv4, rangeToCidrs } from './ipv4';
import { aggregate6, expandIpv6, formatIpv6, parseCidrList6, parseIpv6, rangeToCidrs6 } from './ipv6';

const ipv4Arb = fc.integer({ min: 0, max: 2 ** 32 - 1 });
/** 0 や ffff のグループが続く値を多めに作り、:: による省略の境界（先頭・末尾・複数の候補）を通す */
const ipv6Arb = fc
  .array(fc.oneof(fc.constant(0), fc.constant(0xffff), fc.integer({ min: 0, max: 0xffff })), { minLength: 8, maxLength: 8 })
  .map((groups) => groups.reduce((n, g) => (n << 16n) | BigInt(g), 0n));

/** 範囲の一覧を、重なりと隣接をまとめた [開始, 終了] の一覧にする（期待値を作る素朴な計算） */
function union<A extends number | bigint>(ranges: [A, A][], next: (a: A) => A): [A, A][] {
  const sorted = [...ranges].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const out: [A, A][] = [];
  for (const [start, end] of sorted) {
    const last = out[out.length - 1];
    if (last && start <= next(last[1])) {
      if (end > last[1]) last[1] = end;
    } else out.push([start, end]);
  }
  return out;
}

describe('IPv4', () => {
  it('表示したアドレスを読み直すと、元の値に戻る', () => {
    fc.assert(fc.property(ipv4Arb, (n) => {
      expect(parseIpv4(formatIpv4(n))).toBe(n);
    }));
  });

  it('範囲 → CIDR：範囲をすき間なく重なりなく覆い、各 CIDR は境界にそろい、隣り合う同じ大きさの組をまとめ残さない', () => {
    fc.assert(
      fc.property(ipv4Arb, ipv4Arb, (a, b) => {
        const [start, end] = a <= b ? [a, b] : [b, a];
        const cidrs = rangeToCidrs(start, end);
        let cur = start;
        for (const { network, prefix } of cidrs) {
          const size = 2 ** (32 - prefix);
          expect(network).toBe(cur);
          expect(network % size).toBe(0);
          cur = network + size;
        }
        expect(cur).toBe(end + 1);
        expect(cidrs.length).toBeLessThanOrEqual(62);
        /** 同じ大きさの2つが隣り合い、まとめた大きさの境界にそろっていれば、最小個数ではない */
        cidrs.forEach((c, i) => {
          const next = cidrs[i + 1];
          if (next && next.prefix === c.prefix && c.prefix > 0) expect(c.network % 2 ** (33 - c.prefix)).not.toBe(0);
        });
      }),
    );
  });

  it('集約：出力の CIDR が覆うアドレスは、入力の CIDR が覆うアドレスと同じで、出力どうしは重ならず隣り合わない', () => {
    const cidrArb = fc.tuple(ipv4Arb, fc.integer({ min: 0, max: 32 })).map(([ip, prefix]) => `${formatIpv4(ip)}/${prefix}`);
    fc.assert(
      fc.property(fc.array(cidrArb, { minLength: 1, maxLength: 20 }), (lines) => {
        const input = parseCidrList(lines.join('\n'));
        expect(input.errors).toEqual([]);
        const result = aggregate(lines.join('\n'));
        const output = parseCidrList(result.cidrs.join('\n')).blocks.map((b): [number, number] => [b.start, b.end]);
        const expected = union(input.blocks.map((b): [number, number] => [b.start, b.end]), (a) => a + 1);
        expect(union(output, (a) => a + 1)).toEqual(expected);
        expect(result.addresses).toBe(expected.reduce((sum, [s, e]) => sum + e - s + 1, 0));
        /** 出力どうしは重ならず、隣り合う範囲は（大きさが違っても）続けて並ぶ：まとめ直しても個数が減らない */
        expect(result.cidrs).toEqual(union(output, (a) => a + 1).flatMap(([s, e]) => rangeToCidrs(s, e).map((c) => `${formatIpv4(c.network)}/${c.prefix}`)));
      }),
    );
  });
});

describe('IPv6', () => {
  it('省略した表記・省略しない表記のどちらを読み直しても元の値に戻り、省略した表記は読み直して表示しても変わらない', () => {
    fc.assert(
      fc.property(ipv6Arb, (n) => {
        const short = formatIpv6(n);
        expect(parseIpv6(short)).toBe(n);
        expect(parseIpv6(expandIpv6(n))).toBe(n);
        expect(formatIpv6(parseIpv6(short.toUpperCase()))).toBe(short);
        /** RFC 5952：小文字で、:: は1回まで */
        expect(short).toBe(short.toLowerCase());
        expect(short.split('::').length).toBeLessThanOrEqual(2);
      }),
    );
  });

  it('範囲 → CIDR：範囲をすき間なく重なりなく覆い、各 CIDR は境界にそろう', () => {
    fc.assert(
      fc.property(ipv6Arb, ipv6Arb, (a, b) => {
        const [start, end] = a <= b ? [a, b] : [b, a];
        let cur = start;
        for (const { network, prefix } of rangeToCidrs6(start, end)) {
          const size = 1n << BigInt(128 - prefix);
          expect(network).toBe(cur);
          expect(network % size).toBe(0n);
          cur = network + size;
        }
        expect(cur).toBe(end + 1n);
      }),
    );
  });

  it('集約：出力の CIDR が覆うアドレスは、入力の CIDR が覆うアドレスと同じ', () => {
    const cidrArb = fc.tuple(ipv6Arb, fc.integer({ min: 0, max: 128 })).map(([ip, prefix]) => `${formatIpv6(ip)}/${prefix}`);
    fc.assert(
      fc.property(fc.array(cidrArb, { minLength: 1, maxLength: 20 }), (lines) => {
        const input = parseCidrList6(lines.join('\n'));
        expect(input.errors).toEqual([]);
        const result = aggregate6(lines.join('\n'));
        const output = parseCidrList6(result.cidrs.join('\n')).blocks.map((b): [bigint, bigint] => [b.start, b.end]);
        const expected = union(input.blocks.map((b): [bigint, bigint] => [b.start, b.end]), (a) => a + 1n);
        expect(union(output, (a) => a + 1n)).toEqual(expected);
        expect(result.addresses).toBe(expected.reduce((sum, [s, e]) => sum + e - s + 1n, 0n));
      }),
    );
  });
});
