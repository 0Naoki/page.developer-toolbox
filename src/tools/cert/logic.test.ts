/** 検査の対象：logic.ts・name.ts・pem.ts・extensions.ts（IPv6 の表記）（専用のテストファイルを置かないファイルも、ここでまとめて検査する） */
import { describe, expect, it } from 'vitest';
import { bytesToBase64 } from '../../lib/bytes';
import { SMALL_INTEGER_BYTES, parseDer, parseDerExact, readInteger, readOid, readTime } from '../../lib/crypto/asn1';
import { ED25519, ENCODING_CA_PRINTABLE, ENCODING_LEAF, LEAF, LEAF_CSR, ROOT_CA, ROOT_CA_ROLLOVER } from './certificates.fixtures';
import { checkChain, fingerprints, parseCertificate, parseItem, validityOf, type Certificate, type Csr } from './logic';
import { containsPrivateKey } from '../../lib/crypto/privateKey';
import { MAX_PEM_BLOCKS, readFileBytes, readPem } from './pem';
import { sameBytes, sameName, attributeKey, MAX_NAME_ATTRS, type ParsedName } from './name';
import { certificateWithTime } from './time.fixtures';
import { formatIpv6Bytes } from './extensions';

const cert = (pem: string) => parseItem(readPem(pem)[0]!) as Certificate;

it('開始・終了日時に小数部のある証明書は、有効期間の判定へ渡さない', () => {
  for (const field of ['notBefore', 'notAfter'] as const) {
    expect(() => cert(certificateWithTime(field, '20500101000000.5Z'))).toThrow('証明書の日時に小数部は使えません');
    const accepted = cert(certificateWithTime(field, '20500101000000Z'));
    expect(accepted[field].toISOString()).toBe('2050-01-01T00:00:00.000Z');
  }
});

describe('asn1', () => {
  it('OID全体と各成分の長さを制限し、巨大なBigIntを作らない', () => {
    const oid = (body: number[]) => parseDer(Uint8Array.from([0x06, 0x81, body.length, ...body]));
    expect(readOid(oid(Array(128).fill(0x01))).split('.')).toHaveLength(129);
    expect(() => readOid(oid(Array(129).fill(0x01)))).toThrow('OID が長すぎます');
    expect(readOid(oid([0x2a, ...Array(31).fill(0x81), 0x01]))).toMatch(/^1\.2\.\d+$/);
    expect(() => readOid(oid([0x2a, ...Array(32).fill(0x81), 0x01]))).toThrow('OID の成分が長すぎます');
    /** 先頭の2成分をまとめた値にも同じ上限を適用する。 */
    expect(() => readOid(oid([...Array(32).fill(0x81), 0x01]))).toThrow('OID の成分が長すぎます');
  });
  it('OID を読む', () => {
    /** 1.2.840.113549.1.1.11（sha256WithRSAEncryption） */
    const der = Uint8Array.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]);
    expect(readOid(parseDer(der))).toBe('1.2.840.113549.1.1.11');
    /** 2.999.3（先頭の値が80以上） */
    expect(readOid(parseDer(Uint8Array.from([0x06, 0x03, 0x88, 0x37, 0x03])))).toBe('2.999.3');
  });

  it('53ビットを超える値の OID も丸めずに読む（2.25.<UUID>）', () => {
    /** Number で組み立てると「2.25.3.2980073569858662e+38」のように丸められる */
    const big = 329800735698586629295641978511506172918n; /** UUID f81d4fae-7dec-11d0-a765-00a0c91e6bf6（RFC 4122 の例） */
    const arcs: number[] = [];
    for (let v = big; v > 0n; v >>= 7n) arcs.unshift(Number(v & 0x7fn));
    const body = [0x69, ...arcs.map((a, i) => (i < arcs.length - 1 ? a | 0x80 : a))];
    expect(readOid(parseDer(Uint8Array.from([0x06, body.length, ...body])))).toBe(`2.25.${big}`);
    expect(() => readOid(parseDer(Uint8Array.from([0x06, 0x01, 0x81])))).toThrow('途中で切れています');
    /** 先頭は読めても最後の値が切れている場合も、切れた部分を捨てて「1.2」としない */
    expect(() => readOid(parseDer(Uint8Array.from([0x06, 0x02, 0x2a, 0x86])))).toThrow('途中で切れています');
  });

  it('UTCTime の2桁の年は、50以上を1900年代、50未満を2000年代とする', () => {
    const time = (tag: number, s: string) => readTime(parseDer(Uint8Array.from([tag, s.length, ...Array.from(s, (c) => c.charCodeAt(0))])));
    expect(time(0x17, '500101000000Z').toISOString()).toBe('1950-01-01T00:00:00.000Z');
    expect(time(0x17, '491231235959Z').toISOString()).toBe('2049-12-31T23:59:59.000Z');
    expect(time(0x18, '20500101000000Z').toISOString()).toBe('2050-01-01T00:00:00.000Z');
    expect(time(0x17, '2601010900+0900').toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(() => time(0x17, '26010100Z')).toThrow('読めません');
  });

  it('GeneralizedTime の小数秒・小数分を切り捨てずに拒否する', () => {
    const time = (s: string) => readTime(parseDer(Uint8Array.from([0x18, s.length, ...Array.from(s, (c) => c.charCodeAt(0))])));
    for (const s of ['20500101000000.5Z', '20500101000000.0Z', '205001010000.5Z', '20500101090000.5+0900']) {
      expect(() => time(s), s).toThrow('証明書の日時に小数部は使えません');
    }
    expect(time('20500101000000Z').toISOString()).toBe('2050-01-01T00:00:00.000Z');
    expect(time('20500101090000+0900').toISOString()).toBe('2050-01-01T00:00:00.000Z');
  });

  it('長い日時の値は、エラーの文言に抜粋だけを入れる', () => {
    const s = '2'.repeat(60_000);
    const der = Uint8Array.from([0x18, 0x82, s.length >> 8, s.length & 0xff, ...Array.from(s, (c) => c.charCodeAt(0))]);
    let message = '';
    try { readTime(parseDer(der)); } catch (e) { message = (e as Error).message; }
    expect(message).toBe(`日時「${'2'.repeat(255)}…」を読めません`);
  });

  it('存在しない日付・時刻は、翌月や翌日に繰り上げずにエラーにする', () => {
    const time = (tag: number, s: string) => readTime(parseDer(Uint8Array.from([tag, s.length, ...Array.from(s, (c) => c.charCodeAt(0))])));
    /** Date は2月30日を3月2日に繰り上げるため、先に範囲を確かめる必要がある */
    for (const s of ['230230000000Z', '230431000000Z', '231301000000Z', '230100000000Z', '230101240000Z', '230101006000Z', '230101000060Z']) {
      expect(() => time(0x17, s), s).toThrow('存在しない日付・時刻です');
    }
    expect(() => time(0x18, '21000229000000Z')).toThrow('存在しない日付・時刻です');
    /** うるう年の2月29日は受け付ける */
    expect(time(0x18, '20240229000000Z').toISOString()).toBe('2024-02-29T00:00:00.000Z');
    expect(time(0x18, '20000229235959Z').toISOString()).toBe('2000-02-29T23:59:59.000Z');
  });

  it('壊れたデータは範囲外を読まずにエラーにする', () => {
    expect(() => parseDer(Uint8Array.from([0x30, 0x05, 0x02, 0x01]))).toThrow('途中で切れています');
    expect(() => parseDer(Uint8Array.from([0x30, 0x80, 0x00, 0x00]))).toThrow('長さ不定');
    expect(() => parseDerExact(Uint8Array.from([0x05, 0x00, 0x05, 0x00]))).toThrow('余分なデータ');
    expect(() => parseDer(Uint8Array.from([0x30, 0x85, 1, 1, 1, 1, 1]))).toThrow('大きすぎます');
    /** SEQUENCE を100段入れ子にする（長さが128以上の段は 0x81・0x82 で始まる長い形式で書く） */
    const len = (n: number) => (n < 128 ? [n] : n < 256 ? [0x81, n] : [0x82, n >> 8, n & 0xff]);
    let deep = [0x05, 0x00];
    for (let i = 0; i < 100; i++) deep = [0x30, ...len(deep.length), ...deep];
    expect(() => parseDer(Uint8Array.from(deep))).toThrow('深すぎます');
  });
});

describe('readPem', () => {
  it('対応していない PEM の種別名が長くても、エラーには抜粋だけを入れる', () => {
    const type = 'A'.repeat(400_000);
    expect(() => readPem(`-----BEGIN ${type}-----
AAAA
-----END ${type}-----`)).toThrow(/^「A{255}…」には対応していません/);
  });

  it('PEMのブロック数を貼り付けとファイルの両方で制限する', () => {
    const block = '-----BEGIN CERTIFICATE-----\nMAA=\n-----END CERTIFICATE-----\n';
    const atLimit = block.repeat(MAX_PEM_BLOCKS);
    const overLimit = atLimit + block;
    expect(readPem(atLimit)).toHaveLength(MAX_PEM_BLOCKS);
    expect(() => readPem(overLimit)).toThrow('分割');
    expect(() => readFileBytes(new TextEncoder().encode(overLimit))).toThrow('分割');
  });
  it('複数の証明書を順に読む', () => {
    const items = readPem(`${LEAF}\n\n${ROOT_CA}\n`);
    expect(items.map((i) => i.type)).toEqual(['CERTIFICATE', 'CERTIFICATE']);
  });

  it('BEGIN の行がなければ、全体を Base64 の DER として読む', () => {
    const body = LEAF.split('\n').slice(1, -1).join('\n');
    expect(cert(LEAF).serial).toBe((parseItem(readPem(body)[0]!) as Certificate).serial);
  });

  it('秘密鍵は解析せずにエラーにする', () => {
    for (const label of ['PRIVATE KEY', 'RSA PRIVATE KEY', 'EC PRIVATE KEY', 'ENCRYPTED PRIVATE KEY']) {
      const pem = `-----BEGIN ${label}-----\nMIIBVgIBADANBg\n-----END ${label}-----`;
      expect(containsPrivateKey(pem)).toBe(true);
      expect(() => readPem(`${LEAF}\n${pem}`), label).toThrow('秘密鍵が含まれています');
    }
  });

  it('見出しのない DER の秘密鍵も、解析せずにエラーにする', async () => {
    const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey));
    const shapes: Record<string, Uint8Array> = {
      'PKCS#8': pkcs8,
      'SEC 1': Uint8Array.from([0x30, 0x06, 2, 1, 1, 4, 1, 0]),
      'PKCS#1': Uint8Array.from([0x30, 0x09, 2, 1, 0, 2, 1, 1, 2, 1, 1]),
      '暗号化された PKCS#8': Uint8Array.from([0x30, 0x05, 0x30, 0x00, 4, 1, 0]),
    };
    for (const [label, der] of Object.entries(shapes)) {
      expect(() => readFileBytes(der), label).toThrow('秘密鍵が含まれています');
      expect(() => readPem(bytesToBase64(der)), label).toThrow('秘密鍵が含まれています');
    }
  });

  it('見出しのない DER の証明書は、今までどおり読む', () => {
    const der = readPem(LEAF)[0]!.der;
    expect(readPem(bytesToBase64(der))[0]!.type).toBe('BASE64');
  });

  it('対応していない種類・壊れた PEM はエラー', () => {
    expect(() => readPem('-----BEGIN PUBLIC KEY-----\nMCow\n-----END PUBLIC KEY-----')).toThrow('「PUBLIC KEY」には対応していません');
    expect(() => readPem('-----BEGIN CERTIFICATE-----\nMIIB')).toThrow('そろっていません');
    expect(() => readPem('これは証明書ではない')).toThrow('Base64');
    /** 文字数が4の倍数でない Base64 も、atob の英語の例外ではなく日本語で伝える */
    expect(() => readPem('-----BEGIN CERTIFICATE-----\nMIIBA\n-----END CERTIFICATE-----')).toThrow('Base64 として読めません（文字数が正しくありません');
  });

  it('閉じていない BEGIN が多い大きな入力でも、すぐにエラーを返す（画面を固めない）', () => {
    /** BEGIN ごとに末尾まで読み直す実装では、この入力（約76万文字）に約8秒かかる */
    const many = '-----BEGIN CERTIFICATE-----\n'.repeat(20000) + 'A'.repeat(200000);
    const start = performance.now();
    expect(() => readPem(many)).toThrow('そろっていません');
    expect(performance.now() - start).toBeLessThan(200);
  });

  it('閉じていない BEGIN の後ろに正しい証明書があっても、組がそろっていないことを伝える', () => {
    expect(() => readPem(`-----BEGIN CERTIFICATE-----\nMIIB\n${LEAF}`)).toThrow();
    expect(() => readPem(`-----BEGIN XYZ\n${LEAF}`)).toThrow('そろっていません');
  });

  it('DER のファイルはそのまま、テキストのファイルは PEM として読む', () => {
    const der = readPem(LEAF)[0]!.der;
    expect(readFileBytes(der)).toEqual([{ type: 'DER', der }]);
    expect(readFileBytes(new TextEncoder().encode(LEAF))[0]?.type).toBe('CERTIFICATE');
  });
});

describe('parseCertificate（openssl x509 -text と照合）', () => {
  it('サーバー証明書（ECDSA P-256、SAN・鍵用途付き）', () => {
    const c = cert(LEAF);
    expect(c.version).toBe(3);
    expect(c.serial).toBe('01:23:45:67:89:AB:CD:EF');
    expect(c.signatureAlgorithm).toBe('SHA-256 + RSA');
    expect(c.issuer.text).toBe('C=JP, O=Dev Toolbox Test, CN=Dev Toolbox Test Root CA');
    expect(c.subject.text).toBe('C=JP, O=テスト株式会社, CN=www.example.test');
    expect(c.notBefore.toISOString()).toBe('2026-10-31T15:59:10.000Z');
    expect(c.notAfter.toISOString()).toBe('2027-12-02T15:59:10.000Z');
    expect(c.publicKey).toEqual({ algorithm: 'ECDSA', bits: 256, detail: 'ECDSA P-256（256ビット）' });
    expect(c.san).toEqual([
      { type: 'DNS', value: 'www.example.test' },
      { type: 'DNS', value: '*.example.test' },
      { type: 'IP', value: '192.0.2.10' },
      { type: 'IP', value: '2001:db8::1' },
      { type: 'メール', value: 'admin@example.test' },
    ]);
    expect(c.keyUsage).toEqual(['デジタル署名（digitalSignature）']);
    expect(c.extKeyUsage).toEqual(['サーバー認証（serverAuth）', 'クライアント認証（clientAuth）']);
    expect(c.ca).toBe(false);
    expect(c.subjectKeyId).toBe('09:34:EB:40:08:7B:A6:BA:B8:25:2E:73:94:82:32:5A:50:5D:ED:E5');
    expect(c.authorityKeyId).toBe('34:EC:E7:9E:DB:1B:3F:50:F6:B2:04:85:58:0B:FD:0A:3F:F1:ED:30');
    expect(c.selfIssued).toBe(false);
    const ext = (oid: string) => c.extensions.find((e) => e.oid === oid)!;
    expect(ext('2.5.29.31').values).toEqual(['URI: http://crl.example.test/root.crl']);
    expect(ext('1.3.6.1.5.5.7.1.1').values).toEqual(['OCSP: http://ocsp.example.test', 'CA の証明書: http://ca.example.test/root.crt']);
    expect(ext('2.5.29.15').critical).toBe(true);
    expect(ext('2.5.29.37').critical).toBe(false);
  });

  it('ルート CA（RSA 2048ビット、自己署名）', () => {
    const c = cert(ROOT_CA);
    expect(c.serial).toBe('57:84:8A:3B:DB:D6:05:3C:C0:2E:41:30:FE:5B:1D:A1:DF:35:6C:8A');
    expect(c.publicKey.detail).toBe('RSA 2048ビット（公開指数 65537）');
    expect(c.ca).toBe(true);
    expect(c.keyUsage).toEqual(['証明書の署名（keyCertSign）', 'CRL の署名（cRLSign）']);
    expect(c.selfIssued).toBe(true);
    expect(c.subjectKeyId).toBe('34:EC:E7:9E:DB:1B:3F:50:F6:B2:04:85:58:0B:FD:0A:3F:F1:ED:30');
  });

  it('2050年以降の日時（GeneralizedTime）と Ed25519', () => {
    const c = cert(ED25519);
    expect(c.notAfter.toISOString()).toBe('2056-12-12T15:59:11.000Z');
    expect(c.publicKey.algorithm).toBe('Ed25519');
    expect(c.signatureAlgorithm).toBe('Ed25519');
    expect(c.subject.text).toBe('CN=Long Lived Ed25519');
  });

  it('フィンガープリント（openssl x509 -fingerprint と同じ）', async () => {
    expect(await fingerprints(readPem(LEAF)[0]!.der)).toEqual({
      sha256: 'F6:46:5D:CE:C6:0F:BE:FB:9E:9C:C0:82:1D:23:66:A8:C0:0E:22:7D:24:B8:14:A0:5E:69:7E:EA:FB:07:71:4D',
      sha1: '35:B1:73:29:36:DE:1F:C4:05:A1:5E:B5:02:B1:A1:D6:89:E9:CB:A9',
    });
    expect((await fingerprints(readPem(ROOT_CA)[0]!.der)).sha256).toBe(
      '66:83:8C:41:5E:F0:6E:27:F1:58:01:DE:32:EE:59:A5:73:C8:04:92:03:B7:DC:3C:B1:C3:8E:CA:4C:BE:C2:BD',
    );
  });

  it('証明書ではないデータはエラー', () => {
    expect(() => parseCertificate(Uint8Array.from([0x30, 0x03, 0x02, 0x01, 0x01]))).toThrow();
    expect(() => parseItem({ type: 'CERTIFICATE', der: Uint8Array.from([0x05, 0x00]) })).toThrow('証明書として読めません');
  });
});

describe('parseCsr', () => {
  it('サブジェクト・公開鍵・拡張要求の SAN', () => {
    const csr = parseItem(readPem(LEAF_CSR)[0]!) as Csr;
    expect(csr.kind).toBe('csr');
    expect(csr.subject.text).toBe('C=JP, O=テスト株式会社, CN=www.example.test');
    expect(csr.publicKey.detail).toBe('ECDSA P-256（256ビット）');
    expect(csr.signatureAlgorithm).toBe('ECDSA + SHA-256');
    expect(csr.san.map((g) => g.value)).toEqual(['www.example.test', '*.example.test', '192.0.2.10', '2001:db8::1', 'admin@example.test']);
  });

  it('DER で渡されても、証明書でなければ CSR として読む', () => {
    expect(parseItem({ type: 'DER', der: readPem(LEAF_CSR)[0]!.der }).kind).toBe('csr');
  });
});

describe('validityOf', () => {
  const c = cert(LEAF); /** 2026-10-31 〜 2027-12-02 */
  it('期限前・有効・30日以内・期限切れ', () => {
    expect(validityOf(c, Date.parse('2026-10-01T00:00:00Z')).status).toBe('notYet');
    expect(validityOf(c, Date.parse('2027-01-01T00:00:00Z'))).toEqual({ status: 'valid', daysLeft: 335 });
    expect(validityOf(c, Date.parse('2027-11-20T00:00:00Z'))).toEqual({ status: 'soon', daysLeft: 12 });
    expect(validityOf(c, Date.parse('2027-12-03T00:00:00Z')).status).toBe('expired');
  });

  it('期限切れは過ぎた日数を切り捨てて数える（2分後は0日、1日と2分後は1日）', () => {
    const notAfter = c.notAfter.getTime();
    expect(validityOf(c, notAfter + 120_000)).toEqual({ status: 'expired', daysLeft: 0 });
    expect(validityOf(c, notAfter + 86_400_000 + 120_000)).toEqual({ status: 'expired', daysLeft: -1 });
    expect(validityOf(c, notAfter - 60_000)).toEqual({ status: 'soon', daysLeft: 0 });
  });
});

describe('checkChain', () => {
  const leaf = cert(LEAF);
  const root = cert(ROOT_CA);
  const ed = cert(ED25519);

  it('名前が同じで鍵が違う CA 証明書は、自己署名とみなさず、鍵識別子で発行者とつなぐ', () => {
    const rollover = cert(ROOT_CA_ROLLOVER);
    expect(rollover.selfIssued).toBe(false);
    const r = checkChain([rollover, root]);
    expect(r.links).toEqual([{ from: 0, to: 1, ok: true }]);
    /** 途中の自己署名の警告は出さない */
    expect(r.messages.some((m) => m.text.includes('自己発行（発行者名とサブジェクトが一致）の証明書ですが、途中'))).toBe(false);
  });

  it('正しい順番', () => {
    const r = checkChain([leaf, root]);
    expect(r.links).toEqual([{ from: 0, to: 1, ok: true }]);
    /** 最後の証明書が自己署名のルート証明書かは、署名の検証結果に合わせて画面で伝える */
    expect(r.messages.map((m) => m.level)).toEqual(['good']);
  });

  it('逆の順番', () => {
    expect(checkChain([root, leaf]).messages[0]?.text).toContain('順番が逆です');
  });

  it('つながらない証明書と、途中の自己署名', () => {
    const r = checkChain([leaf, ed]);
    expect(r.links[0]?.ok).toBe(false);
    expect(r.messages.some((m) => m.level === 'bad' && m.text.includes('1 枚目と 2 枚目'))).toBe(true);
    expect(checkChain([leaf, root, ed]).messages.some((m) => m.text.includes('2 枚目は自己発行'))).toBe(true);
  });

  it('名前だけで「自己署名のルート証明書」と断定しない（署名を検証してから画面で伝える）', () => {
    expect(checkChain([leaf, root]).messages.map((m) => m.text).join()).not.toContain('自己署名');
  });
});

describe('巨大な整数', () => {
  const len = (n: number) => (n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : n < 0x10000 ? [0x82, n >> 8, n & 0xff] : [0x83, n >> 16, (n >> 8) & 0xff, n & 0xff]);
  const tlv = (tag: number, body: number[]) => [tag, ...len(body.length), ...body];

  it('長すぎる整数は、変換せずにすぐエラーにする', () => {
    const value = new Array(256 * 1024).fill(0x7f);
    const node = parseDer(new Uint8Array(tlv(0x02, value)));
    const started = performance.now();
    expect(() => readInteger(node, SMALL_INTEGER_BYTES)).toThrow('整数が長すぎます（8バイトまで）');
    /** 上限内でも、長さに比例する時間で読む（以前は 256KB で約24秒かかった） */
    expect(readInteger(node, value.length) > 0n).toBe(true);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('証明書のバージョンの欄の巨大な整数は、すぐに読めないと伝える', () => {
    const cert = new Uint8Array(tlv(0x30, tlv(0x30, tlv(0xa0, tlv(0x02, new Array(64 * 1024).fill(0x7f))))));
    const pem = `-----BEGIN CERTIFICATE-----\n${bytesToBase64(cert)}\n-----END CERTIFICATE-----`;
    expect(() => parseItem(readPem(pem)[0]!)).toThrow('整数が長すぎます');
  });

  it('負の数と0を2の補数として読む', () => {
    expect(readInteger(parseDer(new Uint8Array([0x02, 0x01, 0xff])), 8)).toBe(-1n);
    expect(readInteger(parseDer(new Uint8Array([0x02, 0x02, 0x00, 0x80])), 8)).toBe(128n);
    expect(readInteger(parseDer(new Uint8Array([0x02, 0x00])), 8)).toBe(0n);
  });
});

describe('sameName（RFC 5280 7.1）', () => {
  const CN = '2.5.4.3';
  const O = '2.5.4.10';
  const EMAIL = '1.2.840.113549.1.9.1';
  let serial = 0;
  /** 比較に使う項目だけを持つ名前。raw は、作るたびに違う値にする（バイト列の一致で比べる近道に乗らないように） */
  const name = (...rdns: { oid: string; tag: number; value: string; raw?: Uint8Array }[][]): ParsedName => ({
    attrs: [], text: '', raw: new TextEncoder().encode(`name-${serial++}`),
    rdns: rdns.map((rdn) => rdn.map((v) => attributeKey(v.oid, v.tag, v.value, v.raw ?? new TextEncoder().encode(`${v.tag}:${v.value}`)))),
  });

  it('文字列の型・大文字小文字・空白の違いは同じとみなす', () => {
    expect(sameName(name([{ oid: CN, tag: 19, value: 'Test  CA ' }]), name([{ oid: CN, tag: 12, value: 'test ca' }]))).toBe(true);
    /** NFKC：全角の英数字は半角と同じ */
    expect(sameName(name([{ oid: CN, tag: 12, value: 'ＣＡ１' }]), name([{ oid: CN, tag: 30, value: 'ca1' }]))).toBe(true);
  });

  it('属性の種類・値・RDN の数が違えば別の名前とする', () => {
    expect(sameName(name([{ oid: CN, tag: 12, value: 'CA' }]), name([{ oid: O, tag: 12, value: 'CA' }]))).toBe(false);
    expect(sameName(name([{ oid: CN, tag: 12, value: 'CA1' }]), name([{ oid: CN, tag: 12, value: 'CA2' }]))).toBe(false);
    expect(sameName(name([{ oid: CN, tag: 12, value: 'CA' }]), name([{ oid: CN, tag: 12, value: 'CA' }], [{ oid: O, tag: 12, value: 'x' }]))).toBe(false);
  });

  it('複数の属性を持つ RDN は順番を問わない。文字列の型でない値（IA5String）はバイト列で比べる', () => {
    const a = name([{ oid: CN, tag: 12, value: 'a' }, { oid: O, tag: 12, value: 'b' }]);
    const b = name([{ oid: O, tag: 19, value: 'B' }, { oid: CN, tag: 19, value: 'A' }]);
    expect(sameName(a, b)).toBe(true);
    expect(sameName(name([{ oid: EMAIL, tag: 22, value: 'A@example.test' }]), name([{ oid: EMAIL, tag: 22, value: 'a@example.test' }]))).toBe(false);
  });

  it('符号化の違う CA の名前でも、チェーンがつながる', () => {
    const leaf = cert(ENCODING_LEAF);
    const printable = cert(ENCODING_CA_PRINTABLE);
    expect(sameBytes(leaf.issuer.raw, printable.subject.raw)).toBe(false);
    expect(checkChain([leaf, printable]).links).toEqual([{ from: 0, to: 1, ok: true }]);
  });
});

describe('名前の属性の数', () => {
  const len = (n: number) => (n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : n < 0x10000 ? [0x82, n >> 8, n & 0xff] : [0x83, n >> 16, (n >> 8) & 0xff, n & 0xff]);
  const tlv = (tag: number, body: number[]) => [tag, ...len(body.length), ...body];
  const CN_OID = tlv(0x06, [0x55, 0x04, 0x03]);

  it('上限を超える属性を持つ名前は、解析せずにエラーにする', () => {
    const atv = tlv(0x30, [...CN_OID, ...tlv(0x0c, [0x61])]);
    const issuer = tlv(0x30, tlv(0x31, Array.from({ length: MAX_NAME_ATTRS + 1 }, () => atv).flat()));
    const tbs = tlv(0x30, [...tlv(0x02, [1]), ...tlv(0x30, tlv(0x06, [0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02])), ...issuer]);
    const der = new Uint8Array(tlv(0x30, tbs));
    expect(() => parseCertificate(der)).toThrow(`名前の属性が多すぎます（${MAX_NAME_ATTRS}個まで）`);
  });

  it('上限までの属性を持つ名前の比較は、すぐに終わる（以前は属性の数の2乗の時間がかかった）', () => {
    const rdn = (tag: number) => Array.from({ length: MAX_NAME_ATTRS }, (_, i) => attributeKey('2.5.4.3', tag, `cn${i}`, new Uint8Array([i & 0xff])));
    const a: ParsedName = { attrs: [], text: '', raw: new Uint8Array([1]), rdns: [rdn(12)] };
    const b: ParsedName = { attrs: [], text: '', raw: new Uint8Array([2]), rdns: [rdn(19).reverse()] };
    const started = performance.now();
    for (let i = 0; i < 100; i++) expect(sameName(a, b)).toBe(true);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('PEM の改行の形式', () => {
  it.each([['LF', '\n'], ['CRLF', '\r\n'], ['CR', '\r']])('ヘッダー行のある PEM も、%s の改行で本文を読める', (_, newline) => {
    const pem = LEAF.replace('-----BEGIN CERTIFICATE-----\n', '-----BEGIN CERTIFICATE-----\nComment: test\n').replace(/\n/g, newline);
    expect(readPem(pem)[0]!.der).toEqual(readPem(LEAF)[0]!.der);
  });
});

describe('formatIpv6Bytes（SAN・名前の制約の IPv6 アドレス）', () => {
  it('サブネット計算と同じ推奨表記にする（IPv4 射影アドレスは末尾を IPv4 の形で書く）', () => {
    const bytes = (...groups: number[]) => new Uint8Array(groups.flatMap((g) => [g >>> 8, g & 255]));
    expect(formatIpv6Bytes(bytes(0x2001, 0xdb8, 0, 0, 0, 0, 0, 1))).toBe('2001:db8::1');
    expect(formatIpv6Bytes(bytes(0, 0, 0, 0, 0, 0xffff, 0xc000, 0x201))).toBe('::ffff:192.0.2.1');
    /** DER の途中を指すバイト列（byteOffset が 0 でない）でも、その位置から読む */
    const inner = new Uint8Array([0xff, ...bytes(0xfe80, 0, 0, 0, 0, 0, 0, 1)]).subarray(1);
    expect(formatIpv6Bytes(inner)).toBe('fe80::1');
  });
});
