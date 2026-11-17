import { describe, expect, it } from 'vitest';
import {
  aggregate6,
  binaryOf6,
  contains6,
  expandIpv6,
  formatCount,
  formatIpv6,
  isIpv6Text,
  onlyLines,
  kindOf6,
  parseCidrList6,
  parseIpv6,
  parseNetwork6,
  rangeToCidrs6,
  splitNetwork6,
  subnetInfo6,
} from './ipv6';
import { findOverlaps, MAX_ROWS } from './ranges';

it('クラウドの予約数と、AWS・Azure の IPv6 サイズの案内を分ける', () => {
  const info = subnetInfo6(parseIpv6('2001:db8::'), 60, true);
  expect(info.usable).toBe((1n << 68n) - 5n);
  expect(info.notes.join('\n')).toContain('AWS の IPv6 サブネットは /44〜/64（4刻み）');
  expect(info.notes.join('\n')).toContain('Azure の IPv6 サブネットは /64');
  expect(info.notes.join('\n')).toContain('/60 は対象外');
});

const ip = parseIpv6;

describe('IPv6一覧の改行', () => {
  for (const newline of ['\n', '\r\n', '\r']) {
    it(`改行 ${JSON.stringify(newline)} で行番号と集約結果を保つ`, () => {
      const source = ['10.0.0.0/24', '2001:db8::/33 本番', '# コメント', '2001:db8:8000::/33 支店'].join(newline);
      expect(onlyLines(source, true)).toBe('\n2001:db8::/33 本番\n\n2001:db8:8000::/33 支店');
      expect(parseCidrList6(source).blocks.map((block) => block.line)).toEqual([2, 4]);
      const result = aggregate6(['2001:db8::/33', '2001:db8:8000::/33'].join(newline));
      expect(result.cidrs).toEqual(['2001:db8::/32']);
      expect(result.errors).toEqual([]);
    });
  }
});

describe('parseIpv6 と formatIpv6', () => {
  it(':: の省略を展開し、推奨の表記（RFC 5952）に戻す', () => {
    expect(ip('2001:db8::1')).toBe(0x20010db8000000000000000000000001n);
    expect(formatIpv6(ip('2001:0DB8:0000:0000:0000:0000:0000:0001'))).toBe('2001:db8::1');
    expect(formatIpv6(ip('::'))).toBe('::');
    expect(formatIpv6(ip('::1'))).toBe('::1');
    expect(formatIpv6(ip('fe80::'))).toBe('fe80::');
    /** 0 が1グループだけなら省略しない。同じ長さなら先頭の並びを省略する */
    expect(formatIpv6(ip('2001:db8:0:1:1:1:1:1'))).toBe('2001:db8:0:1:1:1:1:1');
    expect(formatIpv6(ip('2001:0:0:1:0:0:0:1'))).toBe('2001:0:0:1::1');
    expect(formatIpv6(ip('2001:db8:0:0:1:0:0:1'))).toBe('2001:db8::1:0:0:1');
  });

  it('省略しない表記', () => {
    expect(expandIpv6(ip('2001:db8::1'))).toBe('2001:0db8:0000:0000:0000:0000:0000:0001');
  });

  it('末尾の IPv4 表記・[ ] で囲んだ表記・ゾーンID', () => {
    expect(formatIpv6(ip('::ffff:192.0.2.1'))).toBe('::ffff:192.0.2.1');
    expect(ip('64:ff9b::192.0.2.33')).toBe(ip('64:ff9b::c000:221'));
    expect(ip('[2001:db8::1]')).toBe(ip('2001:db8::1'));
    expect(ip('fe80::1%eth0')).toBe(ip('fe80::1'));
  });

  it('形式の誤りはエラー', () => {
    expect(() => ip('2001:db8::1::2')).toThrow(':: は1か所');
    expect(() => ip('2001:db8:1:2:3:4:5')).toThrow('8つ必要');
    expect(() => ip('1:2:3:4:5:6:7:8:9')).toThrow('8つ必要');
    expect(() => ip('1:2:3:4::5:6:7:8')).toThrow('多すぎます');
    /** 8つを超えるグループと :: が両方ある場合（数を確かめる前に :: を展開すると RangeError になる） */
    expect(() => ip('1:2:3:4:5:6:7:8:9::1')).toThrow('多すぎます');
    expect(() => ip('2001:db8::12345')).toThrow('16進数4桁まで');
    expect(() => ip('2001:db8::g')).toThrow('16進数4桁まで');
    expect(() => ip('192.168.0.1')).toThrow(': がありません');
    expect(() => ip('::ffff:192.0.2.300')).toThrow('0〜255');
  });
});

describe('parseNetwork6 と subnetInfo6', () => {
  it('/64', () => {
    const { ip: a, prefix } = parseNetwork6('2001:db8:1:2:abcd::5/64');
    const s = subnetInfo6(a, prefix);
    expect(formatIpv6(s.network)).toBe('2001:db8:1:2::');
    expect(formatIpv6(s.last)).toBe('2001:db8:1:2:ffff:ffff:ffff:ffff');
    expect(s.total).toBe(1n << 64n);
    expect(s.usable).toBe(1n << 64n);
  });

  it('/127・/128・アドレスだけ', () => {
    expect(subnetInfo6(ip('2001:db8::1'), 127)).toMatchObject({ usable: 2n });
    expect(subnetInfo6(ip('2001:db8::1'), 128)).toMatchObject({ usable: 1n });
    expect(parseNetwork6('2001:db8::1')).toMatchObject({ prefix: 128, notation: 'host' });
  });

  it('/64 より小さいサブネットでは SLAAC が使えないことを伝える', () => {
    expect(subnetInfo6(ip('2001:db8::'), 80).notes.some((n) => n.includes('SLAAC'))).toBe(true);
    expect(subnetInfo6(ip('2001:db8::'), 64).notes.some((n) => n.includes('SLAAC'))).toBe(false);
  });

  it('クラウドでは先頭4つと末尾1つを除く', () => {
    const s = subnetInfo6(ip('2001:db8::'), 64, true);
    expect(formatIpv6(s.first!)).toBe('2001:db8::4');
    expect(formatIpv6(s.lastUsable!)).toBe('2001:db8::ffff:ffff:ffff:fffe');
    expect(s.usable).toBe((1n << 64n) - 5n);
  });

  it('範囲外のプレフィックス長はエラー', () => {
    expect(() => parseNetwork6('2001:db8::/129')).toThrow('0〜128');
  });

  it('含まれるか', () => {
    expect(contains6(ip('2001:db8::'), 32, ip('2001:db8:ffff::1'))).toBe(true);
    expect(contains6(ip('2001:db8::'), 32, ip('2001:db9::1'))).toBe(false);
  });

  it('2進数は16ビットごとに区切る', () => {
    expect(binaryOf6(ip('8000::1'))).toBe(`1${'0'.repeat(15)}:${`${'0'.repeat(16)}:`.repeat(6)}${'0'.repeat(15)}1`);
  });
});

describe('formatCount', () => {
  it('大きな2のべき乗は 2^n も書く', () => {
    expect(formatCount(1n << 64n)).toBe('2^64（18,446,744,073,709,551,616）');
    expect(formatCount(256n)).toBe('256');
    expect(formatCount((1n << 64n) - 5n)).toBe('18,446,744,073,709,551,611');
  });
});

describe('kindOf6', () => {
  it('特別な用途のアドレス', () => {
    expect(kindOf6(ip('::1')).kinds[0]?.label).toBe('ループバック');
    expect(kindOf6(ip('fe80::1')).kinds[0]?.label).toBe('リンクローカル');
    expect(kindOf6(ip('fd12:3456::1')).kinds[0]?.label).toContain('ユニークローカル');
    expect(kindOf6(ip('2001:db8::1')).kinds[0]?.label).toBe('ドキュメント用');
    expect(kindOf6(ip('ff02::1')).kinds[0]?.label).toBe('マルチキャスト');
    expect(kindOf6(ip('2404:6800::1')).kinds[0]?.label).toBe('グローバルユニキャスト');
    expect(kindOf6(ip('::ffff:10.0.0.1')).kinds[0]?.label).toBe('IPv4 射影アドレス');
    expect(kindOf6(ip('4000::1')).kinds[0]?.label).toContain('未割り当て');
  });

  it('一部だけ重なる範囲', () => {
    expect(kindOf6(ip('::'), (1n << 128n) - 1n).partial).toBe(true);
  });
});

describe('一覧（重複チェック・分割・集約）', () => {
  it('IPv6 の行だけを読み、重なりを見つける', () => {
    const { blocks, warnings, errors } = parseCidrList6('10.0.0.0/16\n2001:db8::/32 本番\n2001:db8:1::5/48\n2001:db9::/32\nfe80::1');
    expect(blocks.map((b) => [b.line, b.text, b.label])).toEqual([
      [2, '2001:db8::/32', '本番'],
      [3, '2001:db8:1::/48', ''],
      [4, '2001:db9::/32', ''],
    ]);
    expect(warnings.map((w) => w.line)).toEqual([3]);
    expect(errors.map((e) => e.line)).toEqual([5]);
    expect(findOverlaps(blocks).overlaps.map((o) => `${o.a.line}-${o.b.line}`)).toEqual(['2-3']);
  });

  it('/48 を /64 に分ける（多いときは先頭だけ）', () => {
    const r = splitNetwork6(ip('2001:db8:abcd::'), 48, 64);
    expect(r.count).toBe(65536n);
    expect(r.subnets.length).toBe(MAX_ROWS);
    expect(formatIpv6(r.subnets[1]!)).toBe('2001:db8:abcd:1::');
    expect(() => splitNetwork6(ip('2001:db8::'), 48, 32)).toThrow('/48〜/128');
    /** 保存された設定が壊れていて数でないときも、BigInt の例外（英語）ではなく説明付きのエラーにする */
    expect(() => splitNetwork6(ip('2001:db8::'), 48, NaN)).toThrow('/48〜/128');
  });

  it('範囲を最小個数の CIDR にし、隣り合う範囲をまとめる', () => {
    expect(rangeToCidrs6(ip('2001:db8::1'), ip('2001:db8::6')).map((c) => `${formatIpv6(c.network)}/${c.prefix}`)).toEqual([
      '2001:db8::1/128',
      '2001:db8::2/127',
      '2001:db8::4/127',
      '2001:db8::6/128',
    ]);
    expect(rangeToCidrs6(0n, (1n << 128n) - 1n)).toEqual([{ network: 0n, prefix: 0 }]);
    const r = aggregate6('2001:db8::/33\n2001:db8:8000::/33\n10.0.0.0/8\n2001:db9::1 - 2001:db9::2');
    expect(r.cidrs).toEqual(['2001:db8::/32', '2001:db9::1/128', '2001:db9::2/128']);
    expect(r.errors).toEqual([]);
  });

  it('範囲は、空白の有無や区切りの記号（- – 〜 ~）によらず読む', () => {
    for (const line of ['2001:db9::1-2001:db9::2', '2001:db9::1 – 2001:db9::2', '2001:db9::1〜2001:db9::2', '2001:db9::1 ~2001:db9::2']) {
      const r = aggregate6(line);
      expect(r.errors, line).toEqual([]);
      expect(r.cidrs, line).toEqual(['2001:db9::1/128', '2001:db9::2/128']);
    }
  });

  it('回帰：区切りの記号が多く並んだ長い行でも、すぐにエラーを返す（入力長の2乗の時間をかけない）', () => {
    /** 値に区切りの記号も含めていたため、どこで区切るかを総当たりし、4万字で約0.8秒、12万字で約8秒かかっていた */
    const line = `:${'-'.repeat(120_000)} a b`;
    const start = performance.now();
    const r = aggregate6(line);
    expect(performance.now() - start).toBeLessThan(200);
    expect(r.cidrs).toEqual([]);
    expect(r.errors).toHaveLength(1);
  });

  it('行の振り分け', () => {
    expect(isIpv6Text('2001:db8::/32 # コメント')).toBe(true);
    expect(isIpv6Text('10.0.0.0/8 # 説明: IPv4')).toBe(false);
    expect(isIpv6Text('2001:db8::1 - 2001:db8::5')).toBe(true);
  });

  it('IPv4 の行の名前に : があっても IPv6 として読まない', () => {
    /** 名前の「:」で IPv6 と判断すると、「10.0.0.0/16 本番: 東京」がエラーになり、IPv4 の重複チェックからも漏れる */
    const list = '10.0.0.0/16 本番: 東京\n10.0.1.0/24 拠点 10:00開始\n2001:db8::/32 本番';
    expect(isIpv6Text('10.0.0.0/16 本番: 東京')).toBe(false);
    expect(parseCidrList6(list).errors).toEqual([]);
    expect(parseCidrList6(list).blocks.map((b) => b.line)).toEqual([3]);
    expect(onlyLines(list, false)).toBe('10.0.0.0/16 本番: 東京\n10.0.1.0/24 拠点 10:00開始\n');
    expect(onlyLines(list, true)).toBe('\n\n2001:db8::/32 本番');
  });
});
