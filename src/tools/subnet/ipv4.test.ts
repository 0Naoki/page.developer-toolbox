/**
 * 検査の対象：ipv4.ts・vlsm.ts・listCalculation.ts・ranges.ts（専用のテストファイルを置かないファイルも、ここでまとめて検査する。ranges.ts の IPv6 での動きは ipv6.test.ts）
 *
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - [R058] サブネットの集約・重複チェック × 読めない行が大量（100万行の「x」、30万行の「10.0.0.256/24」）× IPv4・IPv6 の混在：
 *   行ごとに例外を作らずに短い時間で終え、総数と行の順で先頭20件の文言（例外を投げる関数と同じ文言）を返す。集約は出力の上限を超えた時点で文字列を作るのをやめる
 */
import { describe, expect, it } from 'vitest';
import { aggregate, binaryOf, contains, formatIpv4, kindOf, parseCidrList, parseIpv4, parseNetwork, rangeToCidrs, splitNetwork, subnetInfo } from './ipv4';
import { allocateVlsm, parseHostRequests, MAX_VLSM_LINES, prefixForHosts } from './vlsm';
import { findOverlaps, MAX_LIST_MESSAGES, MAX_ROWS } from './ranges';
import { parseCidrList6, parseNetwork6 } from './ipv6';
import { LINE_BREAK_CASES, withValues } from '../../lib/text/lines.fixtures';
import { DETAIL_PREVIEW_LIMIT, MESSAGE_LIMIT } from '../../lib/text/textPreview';
import { aggregateList, calculateVlsm, checkOverlapList } from './listCalculation';

const ip = parseIpv4;

describe('一覧の改行', () => {
  for (const newline of ['\n', '\r\n', '\r']) {
    it(`改行 ${JSON.stringify(newline)} で件数・行番号・重複・集約・VLSMを保つ`, () => {
      const list = parseCidrList(['10.0.0.0/24 本番', '# コメント', '', 'bad/24', '10.0.0.0/25 支店'].join(newline));
      expect(list.blocks.map((block) => block.line)).toEqual([1, 5]);
      expect(list.errors.map((error) => error.line)).toEqual([4]);
      expect(findOverlaps(list.blocks).overlaps).toHaveLength(1);
      expect(aggregate(['10.0.0.0/24', '10.0.1.0/24'].join(newline)).cidrs).toEqual(['10.0.0.0/23']);
      const hosts = parseHostRequests(['本番 50', '', '# コメント', 'bad', '支店 100'].join(newline));
      expect(hosts.requests.map((request) => request.line)).toEqual([1, 5]);
      expect(hosts.errors.map((error) => error.line)).toEqual([4]);
    });
  }

  it('CR・LF・CRLFが混在するIPv4/IPv6一覧を振り分けても行番号を保つ', () => {
    const result = checkOverlapList('10.0.0.0/24\r10.0.0.0/25\r\n2001:db8::/48\n2001:db8::/56\r# コメント');
    expect(result.count).toBe(4);
    expect(result.errors.total).toBe(0);
    expect(result.overlaps.map(({ a, b }) => [a.line, b.line])).toEqual([[1, 2], [3, 4]]);
    const aggregated = aggregateList('10.0.0.0/24\r10.0.1.0/24\r\n2001:db8::/33\n2001:db8:8000::/33');
    expect(aggregated.output).toBe('10.0.0.0/23\n2001:db8::/32');
    expect(aggregated.errors.total).toBe(0);
  });
});

describe('読めない行が多い一覧', () => {
  it('回帰：読めない行が100万行あっても、行ごとに例外を作らず、件数と先頭20件の文言を返す', () => {
    /**
     * 以前は読めない行ごとに例外を作り、集約・重複チェックとも約10秒（下の30万行を合わせて約20秒）かかって Worker が時間切れになった。
     * 今は単独で約2秒。ほかのテストと並行して遅くなっても誤って落ちないよう、上限は修正前と区別できる12秒にする
     */
    const text = 'x\n'.repeat(1_000_000);
    const started = performance.now();
    const aggregated = aggregateList(text);
    const overlap = checkOverlapList(text);
    for (const { errors } of [aggregated, overlap]) {
      expect(errors.total).toBe(1_000_000);
      expect(errors.items.map((error) => error.line)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    }
    expect(aggregated.errors.items[0]?.message).toBe('「x」は IPv4 アドレスの形式（192.168.0.1 など）ではありません');
    expect(overlap.errors.items[0]?.message).toBe('「x」は CIDR（10.0.0.0/16 など）の形式ではありません');
    /** CIDR の形の行でも、例外を作らずに数える */
    const cidrs = checkOverlapList('10.0.0.256/24\n'.repeat(300_000));
    expect(cidrs.errors.total).toBe(300_000);
    expect(cidrs.errors.items[0]?.message).toBe('「10.0.0.256」の各部は 0〜255 で指定してください');
    expect(performance.now() - started).toBeLessThan(12_000);
  }, 30_000);

  it('IPv4 と IPv6 の誤りを行の順に合わせ、総数は両方を数える', () => {
    /** 奇数行は読めない IPv4、偶数行は読めない IPv6。どちらも20件を超える */
    const lines = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? '10.0.0.256' : 'gg::1'));
    const result = aggregateList(lines.join('\n'));
    expect(result.errors.total).toBe(60);
    expect(result.errors.items.map((error) => error.line)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(result.errors.items[0]?.message).toBe('「10.0.0.256」の各部は 0〜255 で指定してください');
    expect(result.errors.items[1]?.message).toBe('「gg::1」は IPv6 アドレスとして読めません（「gg」は16進数4桁までのグループではありません）');
  });

  it('読めない行の文言は、例外を投げる関数の文言と同じ（範囲の逆順・CIDR でない行・マスクの誤りを含む）', () => {
    const messageOf = (run: () => unknown) => {
      try { run(); } catch (e) { return (e as Error).message; }
      throw new Error('エラーにならない');
    };
    const aggregated = aggregateList(['10.0.0.9 - 10.0.0.1', '10.0.0.0 255.0.255.0', '010.0.0.1', '2001:db8::/129'].join('\n'));
    expect(aggregated.errors.items.map((error) => error.message)).toEqual([
      '開始アドレスが終了アドレスより後ろにあります',
      messageOf(() => parseNetwork('10.0.0.0 255.0.255.0')),
      messageOf(() => parseIpv4('010.0.0.1')),
      messageOf(() => parseNetwork6('2001:db8::/129')),
    ]);
    const overlap = checkOverlapList(['10.0.0.1', '10.0.0.0/33', '2001:db8::1'].join('\n'));
    expect(overlap.errors.items.map((error) => error.message)).toEqual([
      '「10.0.0.1」は CIDR（10.0.0.0/16 など）の形式ではありません',
      messageOf(() => parseNetwork('10.0.0.0/33')),
      '「2001:db8::1」は CIDR（2001:db8::/32 など）の形式ではありません',
    ]);
  });

  it('範囲の先頭でない CIDR の警告も、件数と先頭20件の文言を返す', () => {
    const result = checkOverlapList(Array.from({ length: 30 }, (_, i) => `10.0.${i}.1/24`).join('\n'));
    expect(result.warnings.total).toBe(30);
    expect(result.warnings.items).toHaveLength(20);
    expect(result.warnings.items[0]?.message).toBe('10.0.0.1/24 はネットワークアドレスではないため、10.0.0.0/24 として扱いました');
  });

  it('集約は、出力の文字数が上限を超えた時点で CIDR の文字列を作るのをやめる', () => {
    /** 「10.0.0.1/32」「10.0.0.3/32」はそれぞれ改行を含めて12文字 */
    expect(aggregate('10.0.0.1\n10.0.0.3', 24)).toMatchObject({ cidrs: ['10.0.0.1/32', '10.0.0.3/32'], exceeded: false });
    expect(aggregate('10.0.0.1\n10.0.0.3', 23)).toMatchObject({ cidrs: ['10.0.0.1/32'], exceeded: true });
    expect(aggregate('10.0.0.1\n10.0.0.3', 11)).toMatchObject({ cidrs: [], exceeded: true });
  });
});

describe('長い入力のエラー', () => {
  it('エラーに埋め込む入力は抜粋にする（入力欄のプレビュー制限を迂回しない）', () => {
    const long = 'x'.repeat(1_000_000);
    for (const run of [() => parseIpv4(long), () => parseNetwork(`10.0.0.0 ${long}`), () => parseNetwork6(long)]) {
      let message = '';
      try { run(); } catch (e) { message = (e as Error).message; }
      expect(message).toContain('…');
      expect(message.length).toBeLessThan(DETAIL_PREVIEW_LIMIT + 100);
    }
    const list = parseCidrList(long);
    expect(list.errors[0]?.message.length).toBeLessThan(DETAIL_PREVIEW_LIMIT + 100);
  });

  it('入力が文言の途中に入るエラーでも、抜粋にして後ろの理由を表示の上限で切らない', () => {
    const long = 'f'.repeat(100_000);
    const messageOf = (run: () => unknown) => {
      try { run(); } catch (e) { return (e as Error).message; }
      throw new Error('エラーにならない');
    };
    /** 表示の上限（MESSAGE_LIMIT の1,000単位）の内側に、理由の文言が残る */
    const group = messageOf(() => parseNetwork6(`1:2:3:4:5:6:7:${long}`));
    expect(group.length).toBeLessThan(2 * DETAIL_PREVIEW_LIMIT + 100);
    expect(group).toMatch(/は16進数4桁までのグループではありません）$/);
    const vlsm = messageOf(() => allocateVlsm(parseIpv4('10.0.0.0'), 24, [{ line: 1, name: long, hosts: 1000 }]));
    expect(vlsm.length).toBeLessThan(DETAIL_PREVIEW_LIMIT + 100);
    expect(vlsm).toMatch(/」の \/22 を割り当てられません）$/);
  });

  it('一覧の計算の結果として返す診断文も、抜粋にした入力の後ろの理由を保つ', () => {
    /** 文言を作る側で入力を抜粋にしているため、診断文全体を抜粋の上限で切り直すと、理由が消える */
    const overlap = checkOverlapList(`${'f'.repeat(1000)}::/64`);
    expect(overlap.errors.items[0]?.message).toMatch(/は IPv6 アドレスとして読めません（.+）$/);
    const vlsm = calculateVlsm(`${'n'.repeat(100_000)} 1000`, parseIpv4('10.0.0.0'), 24, false);
    expect(vlsm.error).toMatch(/」の \/22 を割り当てられません）$/);
    /** 表示の上限（MESSAGE_LIMIT）には収める */
    expect(overlap.errors.items[0]?.message.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
    expect(vlsm.error.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
  });
});

describe('parseIpv4', () => {
  it('アドレスを数にし、元に戻す', () => {
    expect(ip('192.168.10.1')).toBe(0xc0a80a01);
    expect(ip('255.255.255.255')).toBe(2 ** 32 - 1);
    expect(formatIpv4(ip('10.0.0.1'))).toBe('10.0.0.1');
    expect(formatIpv4(0)).toBe('0.0.0.0');
  });

  it('形式の誤り・範囲外・先頭の0はエラー', () => {
    expect(() => ip('192.168.1')).toThrow('形式');
    expect(() => ip('1.2.3.256')).toThrow('0〜255');
    expect(() => ip('10.0.0.010')).toThrow('先頭の0');
    expect(() => ip('a.b.c.d')).toThrow('形式');
  });
});

describe('parseNetwork', () => {
  it('CIDR・サブネットマスク・ワイルドカードマスク・アドレスだけ', () => {
    expect(parseNetwork('192.168.10.0/24')).toEqual({ ip: ip('192.168.10.0'), prefix: 24, notation: 'cidr' });
    expect(parseNetwork('10.0.0.5 255.255.255.0')).toEqual({ ip: ip('10.0.0.5'), prefix: 24, notation: 'mask' });
    expect(parseNetwork('10.0.0.5/255.255.0.0')).toEqual({ ip: ip('10.0.0.5'), prefix: 16, notation: 'mask' });
    expect(parseNetwork('10.0.0.0 0.0.0.255')).toEqual({ ip: ip('10.0.0.0'), prefix: 24, notation: 'wildcard' });
    expect(parseNetwork(' 10.1.2.3 ')).toEqual({ ip: ip('10.1.2.3'), prefix: 32, notation: 'host' });
  });

  it('マスクとワイルドカードのどちらとも読める値は、サブネットマスクとして読む', () => {
    expect(parseNetwork('10.0.0.0 0.0.0.0').prefix).toBe(0);
    expect(parseNetwork('10.0.0.0 255.255.255.255').prefix).toBe(32);
  });

  it('不正なプレフィックス長・マスクはエラー', () => {
    expect(() => parseNetwork('10.0.0.0/33')).toThrow('0〜32');
    expect(() => parseNetwork('10.0.0.0 255.0.255.0')).toThrow('ワイルドカードマスクとしても使えません');
  });
});

describe('subnetInfo', () => {
  it('/24', () => {
    const s = subnetInfo(ip('192.168.10.77'), 24);
    expect(formatIpv4(s.network)).toBe('192.168.10.0');
    expect(formatIpv4(s.broadcast)).toBe('192.168.10.255');
    expect(formatIpv4(s.first!)).toBe('192.168.10.1');
    expect(formatIpv4(s.last!)).toBe('192.168.10.254');
    expect(s.usable).toBe(254);
    expect(s.total).toBe(256);
    expect(formatIpv4(s.mask)).toBe('255.255.255.0');
    expect(formatIpv4(s.wildcard)).toBe('0.0.0.255');
  });

  it('/31 は2アドレスとも使える（RFC 3021）、/32 は1アドレス', () => {
    const s31 = subnetInfo(ip('10.0.0.1'), 31);
    expect([formatIpv4(s31.first!), formatIpv4(s31.last!), s31.usable]).toEqual(['10.0.0.0', '10.0.0.1', 2]);
    const s32 = subnetInfo(ip('10.0.0.1'), 32);
    expect([formatIpv4(s32.first!), s32.usable, s32.total]).toEqual(['10.0.0.1', 1, 1]);
  });

  it('/30 と /0', () => {
    expect(subnetInfo(ip('10.0.0.0'), 30).usable).toBe(2);
    const all = subnetInfo(ip('1.2.3.4'), 0);
    expect([all.network, all.broadcast, all.usable]).toEqual([0, 2 ** 32 - 1, 2 ** 32 - 2]);
  });

  it('クラウドでは先頭4つと末尾1つを除く', () => {
    const s = subnetInfo(ip('10.0.1.0'), 24, true);
    expect(formatIpv4(s.first!)).toBe('10.0.1.4');
    expect(formatIpv4(s.last!)).toBe('10.0.1.254');
    expect(s.usable).toBe(251);
    expect(subnetInfo(ip('10.0.1.0'), 28, true).usable).toBe(11);
    expect(subnetInfo(ip('10.0.1.0'), 30, true)).toMatchObject({ usable: 0, first: null });
  });
});

describe('contains', () => {
  it('ネットワークに含まれるか', () => {
    expect(contains(ip('10.0.0.0'), 8, ip('10.255.0.1'))).toBe(true);
    expect(contains(ip('10.0.0.0'), 8, ip('11.0.0.0'))).toBe(false);
    expect(contains(0, 0, ip('8.8.8.8'))).toBe(true);
  });
});

describe('binaryOf', () => {
  it('8桁ごとに区切る', () => {
    expect(binaryOf(ip('192.168.1.1'))).toBe('11000000.10101000.00000001.00000001');
  });
});

describe('kindOf', () => {
  it('特別な用途のアドレスと、グローバル', () => {
    expect(kindOf(ip('192.168.1.1')).kinds[0]?.label).toBe('プライベート');
    expect(kindOf(ip('172.31.255.255')).kinds[0]?.rfc).toBe('RFC 1918');
    expect(kindOf(ip('172.32.0.0')).kinds[0]?.label).toBe('グローバル（パブリック）');
    expect(kindOf(ip('100.64.0.1')).kinds[0]?.label).toContain('CGNAT');
    expect(kindOf(ip('169.254.1.1')).kinds[0]?.label).toBe('リンクローカル');
    expect(kindOf(ip('127.0.0.1')).kinds[0]?.label).toBe('ループバック');
    expect(kindOf(ip('239.1.1.1')).kinds[0]?.label).toBe('マルチキャスト');
    expect(kindOf(ip('203.0.113.5')).kinds[0]?.label).toContain('ドキュメント用');
    expect(kindOf(ip('8.8.8.8')).kinds[0]?.label).toBe('グローバル（パブリック）');
  });

  it('最も細かい範囲の種別を返す（255.255.255.255 は 240.0.0.0/4 ではなくブロードキャスト）', () => {
    expect(kindOf(ip('255.255.255.255')).kinds[0]?.label).toBe('ブロードキャスト（限定）');
  });

  it('範囲が特別なアドレスに一部だけ重なる場合', () => {
    const r = kindOf(ip('192.0.0.0'), ip('192.255.255.255'));
    expect(r.partial).toBe(true);
    expect(r.kinds.map((k) => k.label)).toContain('プライベート');
  });
});

describe('parseCidrList と findOverlaps', () => {
  it('名前とコメントを読み、ネットワークアドレスでない値は直して警告する', () => {
    const r = parseCidrList('10.0.0.0/16 本番VPC\n# コメント\n\n10.0.1.5/24  # 開発\nabc/24');
    expect(r.blocks.map((b) => [b.line, b.text, b.label])).toEqual([
      [1, '10.0.0.0/16', '本番VPC'],
      [4, '10.0.1.0/24', ''],
    ]);
    expect(r.warnings).toEqual([{ line: 4, message: expect.stringContaining('10.0.1.0/24 として扱いました') }]);
    expect(r.errors.map((e) => e.line)).toEqual([5]);
  });

  it('含む・同じ範囲の重なりを見つけ、重ならないものは出さない', () => {
    const { blocks } = parseCidrList('10.0.0.0/16\n10.0.1.0/24\n10.1.0.0/16\n10.0.1.0/24\n192.168.0.0/24');
    const { overlaps } = findOverlaps(blocks);
    expect(overlaps.map((o) => `${o.a.line}-${o.b.line}:${o.kind}`).sort()).toEqual(['1-2:contains', '1-4:contains', '2-4:same']);
  });

  it('隣り合う範囲は重なりではない', () => {
    const { blocks } = parseCidrList('10.0.0.0/24\n10.0.1.0/24');
    expect(findOverlaps(blocks).overlaps).toEqual([]);
  });
});

describe('splitNetwork', () => {
  it('/16 を /24 に分ける', () => {
    const r = splitNetwork(ip('10.0.0.0'), 16, 24);
    expect(r.count).toBe(256);
    expect(formatIpv4(r.subnets[1]!)).toBe('10.0.1.0');
    expect(formatIpv4(r.subnets[255]!)).toBe('10.0.255.0');
  });

  it('件数が多いときは先頭だけ返す', () => {
    const r = splitNetwork(0, 0, 32);
    expect(r.count).toBe(2 ** 32);
    expect(r.subnets.length).toBe(MAX_ROWS);
  });

  it('元より大きいプレフィックスはエラー', () => {
    expect(() => splitNetwork(ip('10.0.0.0'), 16, 8)).toThrow('/16〜/32');
    expect(() => splitNetwork(ip('10.0.0.0'), 16, NaN)).toThrow('/16〜/32');
  });
});

describe('VLSM', () => {
  it('必要なホスト数を満たす最小の大きさ', () => {
    expect(prefixForHosts(2)).toBe(30);
    expect(prefixForHosts(254)).toBe(24);
    expect(prefixForHosts(255)).toBe(23);
    expect(prefixForHosts(1, true)).toBe(28);
    expect(prefixForHosts(251, true)).toBe(24);
    expect(prefixForHosts(252, true)).toBe(23);
  });

  it('大きい順に割り当て、入力の順で返す', () => {
    const { requests } = parseHostRequests('営業 50\n開発 200\n管理 10');
    const r = allocateVlsm(ip('192.168.0.0'), 23, requests);
    expect(r.map((a) => `${a.name} ${formatIpv4(a.network)}/${a.prefix} ${subnetInfo(a.network, a.prefix).usable}`)).toEqual([
      '営業 192.168.1.0/26 62',
      '開発 192.168.0.0/24 254',
      '管理 192.168.1.64/28 14',
    ]);
  });

  it('収まらなければエラー', () => {
    const { requests } = parseHostRequests('A 200\nB 100');
    expect(() => allocateVlsm(ip('192.168.0.0'), 24, requests)).toThrow('収まりません');
  });

  it('形式の誤りは行番号付きで返す', () => {
    expect(parseHostRequests('営業\n開発 0').errors.map((e) => e.line)).toEqual([1, 2]);
  });

  it('読めない行が大量でも、エラーは行の順で先頭 MAX_LIST_MESSAGES 件と総数だけを持つ', () => {
    const { requests, errors, errorTotal } = parseHostRequests('A 2\n' + 'x\n'.repeat(MAX_VLSM_LINES - 1));
    expect(requests).toHaveLength(1);
    expect(errors.map((e) => e.line)).toEqual(Array.from({ length: MAX_LIST_MESSAGES }, (_, i) => i + 2));
    expect(errorTotal).toBe(MAX_VLSM_LINES - 1);
  });

  it('VLSMは行数を制限し、最終行を閉じる改行は行数に含めない', () => {
    for (const newline of ['\n', '\r\n', '\r']) {
      const atLimit = ('#' + newline).repeat(MAX_VLSM_LINES);
      expect(parseHostRequests(atLimit)).toEqual({ requests: [], errors: [], errorTotal: 0 });
      expect(() => parseHostRequests(atLimit + 'A 2')).toThrow('入力を分割');
    }
  });

  it('正の整数でないホスト数は、別の数として読まずにエラーにする', () => {
    for (const line of ['dev -120', 'ops 1.5', 'y 1,500', 'a 1e3', 'x 0x10', 'vlan10', '営業部120', `z ${'9'.repeat(400)}`, 'w 9007199254740992']) {
      const { requests, errors } = parseHostRequests(line);
      expect(requests, line).toEqual([]);
      expect(errors.map((e) => e.line), line).toEqual([1]);
    }
  });

  it('名前の空白を保ち、名前は省略できる', () => {
    expect(parseHostRequests('本社  営業部　120\n60').requests).toEqual([
      { line: 1, name: '本社  営業部', hosts: 120 },
      { line: 2, name: 'サブネット2', hosts: 60 },
    ]);
  });
});

describe('rangeToCidrs と aggregate', () => {
  it('範囲を最小個数の CIDR にする', () => {
    const show = (s: string, e: string) => rangeToCidrs(ip(s), ip(e)).map((c) => `${formatIpv4(c.network)}/${c.prefix}`);
    expect(show('192.168.0.0', '192.168.0.255')).toEqual(['192.168.0.0/24']);
    expect(show('10.0.0.1', '10.0.0.6')).toEqual(['10.0.0.1/32', '10.0.0.2/31', '10.0.0.4/31', '10.0.0.6/32']);
    expect(show('0.0.0.0', '255.255.255.255')).toEqual(['0.0.0.0/0']);
  });

  it('重なり・隣り合う範囲をまとめる', () => {
    const r = aggregate('10.0.0.0/24\n10.0.1.0/24\n10.0.0.128/25\n10.0.2.0 - 10.0.3.255\n10.0.4.1');
    expect(r.cidrs).toEqual(['10.0.0.0/22', '10.0.4.1/32']);
    expect(r.addresses).toBe(1025);
    expect(r.errors).toEqual([]);
  });

  it('誤った行は行番号付きで返し、残りはまとめる', () => {
    const r = aggregate('10.0.0.0/24\n10.0.0.300\n10.0.1.0 - 10.0.0.0');
    expect(r.cidrs).toEqual(['10.0.0.0/24']);
    expect(r.errors.map((e) => e.line)).toEqual([2, 3]);
  });
});

describe('一覧の改行の形式', () => {
  it.each(LINE_BREAK_CASES)('IPv4・IPv6 の一覧で、$name を行の区切りにし、エラーの行番号を元の行に合わせる', ({ text, lines }) => {
    const badLine = lines.indexOf('b') + 1;
    const v4 = parseCidrList(withValues(text, { a: '10.0.0.0/24', b: 'bad/24', c: '10.1.0.0/24', d: '10.2.0.0/24' }));
    expect(v4.errors.map((e) => e.line)).toEqual(badLine > 0 ? [badLine] : []);
    expect(v4.blocks).toHaveLength(lines.filter((l) => l !== '' && l !== 'b').length);
    const v6 = parseCidrList6(withValues(text, { a: '2001:db8::/48', b: 'xyz::/48', c: '2001:db8:1::/48', d: '2001:db8:2::/48' }));
    expect(v6.errors.map((e) => e.line)).toEqual(badLine > 0 ? [badLine] : []);
  });
});
