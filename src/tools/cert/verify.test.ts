import { describe, expect, it } from 'vitest';
import { parseDer, valueOf, type Node } from '../../lib/crypto/asn1';
import { ED25519, ENCODING_CA_PRINTABLE, ENCODING_LEAF, LEAF, LEAF_CSR, LEAF_PSS, PSS_CSR, ROLLOVER_NEW_CA, ROLLOVER_OLD_CA, ROOT_CA, ROOT_CA_ROLLOVER, SAME_NAME_CA1, SAME_NAME_CA2, SAME_NAME_LEAF } from './certificates.fixtures';
import { parseItem, type Certificate, type Csr } from './logic';
import { readPem } from './pem';
import { sameBytes } from './name';
import { verifyInList, verifySigned } from './verify';

const parse = (pem: string) => parseItem(readPem(pem)[0]!);
const leaf = parse(LEAF) as Certificate;
const root = parse(ROOT_CA) as Certificate;
const ed = parse(ED25519) as Certificate;
const pss = parse(LEAF_PSS) as Certificate;
const csr = parse(LEAF_CSR) as Csr;

/** 本体の1バイトを書き換えた（改ざんした）署名の部品 */
const tampered = (c: Certificate) => {
  const tbs = new Uint8Array(c.signed.tbs);
  tbs[tbs.length - 10]! ^= 1;
  return { ...c.signed, tbs };
};

describe('verifySigned（openssl verify で正しいと確かめた証明書）', () => {
  it('RSA（PKCS#1 v1.5、SHA-256）：ルート CA の鍵でサーバー証明書を検証する', async () => {
    expect(await verifySigned(leaf.signed, root.signed.spki)).toMatchObject({ status: 'valid' });
  });

  it('RSA-PSS（SHA-256、ソルト長32）', async () => {
    expect(await verifySigned(pss.signed, root.signed.spki)).toMatchObject({ status: 'valid' });
  });

  it('自己署名：RSA のルート CA と Ed25519', async () => {
    expect(await verifySigned(root.signed, root.signed.spki)).toMatchObject({ status: 'valid' });
    expect(await verifySigned(ed.signed, ed.signed.spki)).toMatchObject({ status: 'valid' });
  });

  it('ECDSA P-256（DER の署名を r と s の形に直して検証する）：CSR を自分の鍵で検証する', async () => {
    expect(await verifySigned(csr.signed, csr.signed.spki)).toMatchObject({ status: 'valid' });
  });

  it('本体が書き換えられていると一致しない', async () => {
    expect(await verifySigned(tampered(leaf), root.signed.spki)).toMatchObject({ status: 'invalid', message: expect.stringContaining('一致しません') });
    expect(await verifySigned(tampered(ed), ed.signed.spki)).toMatchObject({ status: 'invalid' });
  });

  it('別の発行者の鍵では一致しない', async () => {
    /** サーバー証明書（ECDSA の鍵）で、RSA で署名されたルート CA を検証しようとする */
    expect(await verifySigned(root.signed, leaf.signed.spki)).toMatchObject({ status: 'invalid', message: expect.stringContaining('鍵の種類（ECDSA）') });
    expect(await verifySigned(leaf.signed, ed.signed.spki)).toMatchObject({ status: 'invalid' });
  });

  it('ブラウザで検証できない署名アルゴリズムは「対応していない」と返す', async () => {
    /** 署名アルゴリズムを MD5 + RSA（1.2.840.113549.1.1.4）にすり替える */
    const md5 = parseDer(Uint8Array.from([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x04, 0x05, 0x00]));
    expect(await verifySigned({ ...leaf.signed, algorithm: md5 }, root.signed.spki)).toMatchObject({ status: 'unsupported', message: expect.stringContaining('MD5') });
  });

  it('ブラウザが対応していない曲線（secp256k1）の鍵は「一致しない」ではなく「検証できない」と返す', async () => {
    /**
     * 鍵の種類を「その他」とみなすと、改ざんと同じ「一致しません」になってしまう
     * secp256k1 の公開鍵（SubjectPublicKeyInfo）。曲線で判断するので、鍵の値はダミーでよい
     * SEQUENCE \{ SEQUENCE \{ id-ecPublicKey, secp256k1（1.3.132.0.10） \}, BIT STRING \}
     */
    const spki = Uint8Array.from([0x30, 0x16, 0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a, 0x03, 0x02, 0x00, 0x04]);
    const ecdsaSha256 = parseDer(Uint8Array.from([0x30, 0x0a, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]));
    const signed = { tbs: Uint8Array.from([1]), algorithm: ecdsaSha256, signature: Uint8Array.from([0x30, 0x06, 2, 1, 1, 2, 1, 1]), spki };
    expect(await verifySigned(signed, spki)).toEqual({
      status: 'unsupported',
      message: 'この曲線（secp256k1）の署名は、ブラウザ（Web Crypto API）で検証できません',
    });
    /** RSA の署名を secp256k1 の鍵で検証しようとするのは、鍵の種類の違い（一致しない） */
    expect(await verifySigned({ ...leaf.signed }, spki)).toMatchObject({ status: 'invalid', message: expect.stringContaining('鍵の種類（ECDSA）') });
  });

  it('Ed25519 に対応していないブラウザでは「対応していない」と返す', async () => {
    const subtle = {
      importKey: () => Promise.reject(Object.assign(new Error('unsupported'), { name: 'NotSupportedError' })),
    } as unknown as SubtleCrypto;
    expect(await verifySigned(ed.signed, ed.signed.spki, subtle)).toMatchObject({ status: 'unsupported', message: expect.stringContaining('Ed25519') });
  });
});

describe('verifySigned：署名の形式を厳密に読む', () => {
  const concat = (...parts: (Uint8Array | number[])[]) => Uint8Array.from(parts.flatMap((p) => [...p]));
  const tlv = (tag: number, value: Uint8Array) => concat([tag], value.length < 0x80 ? [value.length] : [0x81, value.length], value);
  const original = csr.signed.signature;
  const [rNode, sNode] = parseDer(original).children as [Node, Node];
  const r = valueOf(rNode);
  const s = valueOf(sNode);
  const encode = (rTag: number, sTag: number, outer = 0x30, rValue: Uint8Array = r) => tlv(outer, concat(tlv(rTag, rValue), tlv(sTag, s)));

  it('正しい DER に組み立て直した署名は一致する', async () => {
    expect(await verifySigned({ ...csr.signed, signature: encode(2, 2) }, csr.signed.spki)).toMatchObject({ status: 'valid' });
  });

  it('r と s の値が同じでも、DER でない署名は受け付けない', async () => {
    const changed: Record<string, Uint8Array> = {
      'r が OCTET STRING': encode(4, 2),
      's が OCTET STRING': encode(2, 4),
      '外側が SET': encode(2, 2, 0x31),
      '外側が文脈タグ': encode(2, 2, 0xa0),
      '余分なデータ': concat(original, [0xde, 0xad]),
      '3つ目の要素': tlv(0x30, concat(tlv(2, r), tlv(2, s), tlv(2, Uint8Array.of(1)))),
      '余分な先頭の0': encode(2, 2, 0x30, concat([0], r)),
      '長さが最短でない': concat([0x30, 0x81, original[1]!], original.subarray(2)),
      '負の値': encode(2, 2, 0x30, concat([0x80], r)),
      's がない': tlv(0x30, tlv(2, r)),
    };
    for (const [label, signature] of Object.entries(changed)) {
      expect(await verifySigned({ ...csr.signed, signature }, csr.signed.spki), label).toMatchObject({ status: 'invalid', message: '署名の形式が正しくありません' });
    }
  });

  it('BIT STRING の未使用ビット数が0でない署名は受け付けない', async () => {
    const der = new Uint8Array(csr.der);
    der[parseDer(der).children[2]!.valueStart] = 1;
    const changed = parseItem({ type: 'CERTIFICATE REQUEST', der }) as Csr;
    expect(await verifySigned(changed.signed, changed.signed.spki)).toMatchObject({ status: 'invalid', message: expect.stringContaining('未使用ビット') });
  });

  it('証明書の本体の中と外側で署名アルゴリズムが異なれば無効', async () => {
    /** sha256WithRSAEncryption の OID。最初に現れるのは本体の中 */
    const oid = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b];
    const der = new Uint8Array(leaf.der);
    const at = der.findIndex((_, i) => oid.every((b, k) => der[i + k] === b));
    der[at + oid.length - 1] = 0x0c;
    const changed = parseItem({ type: 'CERTIFICATE', der }) as Certificate;
    expect(await verifySigned(changed.signed, root.signed.spki)).toEqual({ status: 'invalid', message: '証明書の本体の中と外側で、署名アルゴリズムが異なります' });
  });
});

describe('verifyInList', () => {
  it('一覧の中から発行者を探して検証する（順番は問わない）', async () => {
    const r = await verifyInList(leaf, [root, leaf]);
    expect(r?.by).toBe('発行者「Dev Toolbox Test Root CA」の公開鍵');
    expect(r?.result.status).toBe('valid');
  });

  it('自己署名と CSR は自分の鍵で検証する', async () => {
    expect((await verifyInList(root, [root]))?.by).toContain('自己署名');
    expect((await verifyInList(csr, []))?.by).toBe('CSR 自身の公開鍵');
  });

  it('名前が同じで鍵が違う CA 証明書は、自己署名とみなさず発行者の鍵で検証する', async () => {
    /** 名前の一致だけで自己署名とみなすと、自分の鍵で検証して「一致しません」になる */
    const rollover = parse(ROOT_CA_ROLLOVER) as Certificate;
    expect(rollover.selfIssued).toBe(false);
    const r = await verifyInList(rollover, [rollover, root]);
    expect(r?.by).toBe('発行者「Dev Toolbox Test Root CA」の公開鍵');
    expect(r?.result.status).toBe('valid');
    /** 発行者（古い鍵の ROOT_CA）が一覧になければ検証できない */
    expect(await verifyInList(rollover, [rollover])).toBeNull();
  });

  it('発行者が一覧にないときは null', async () => {
    expect(await verifyInList(leaf, [leaf, ed])).toBeNull();
  });
});

/** DER の要素（短い値だけ）を組み立てる */
const derLength = (n: number) => (n < 0x80 ? [n] : [0x81, n]);
const tlv = (tag: number, body: number[]) => [tag, ...derLength(body.length), ...body];

describe('RSA-PSS のパラメーター（RFC 4055）', () => {
  /** CSR の外側の署名アルゴリズムは署名の対象ではないため、書き換えても署名の値は正しいまま */
  const pssCsr = parse(PSS_CSR) as Csr;
  /** パラメーターの項目を差し替えた署名アルゴリズムで検証する */
  const verifyWith = (items: number[][]) => {
    const raw = new Uint8Array(tlv(0x30, [...ALG_OID, ...tlv(0x30, items.flat())]));
    return verifySigned({ ...pssCsr.signed, algorithm: parseDer(raw) }, pssCsr.signed.spki);
  };
  const ALG_OID = tlv(0x06, [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0a]);
  const SHA256 = tlv(0x30, tlv(0x06, [0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]));
  const HASH = tlv(0xa0, SHA256);
  const mgf = (oid: number[]) => tlv(0xa1, tlv(0x30, [...tlv(0x06, oid), ...SHA256]));
  const MGF1 = mgf([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x08]);
  const SALT = tlv(0xa2, tlv(0x02, [0x20]));
  const trailer = (n: number) => tlv(0xa3, tlv(0x02, [n]));

  it('正しいパラメーターは、trailerField 1 を明示しても検証できる', async () => {
    expect(await verifyInList(pssCsr, [])).toMatchObject({ result: { status: 'valid' } });
    expect(await verifyWith([HASH, MGF1, SALT])).toMatchObject({ status: 'valid' });
    expect(await verifyWith([HASH, MGF1, SALT, trailer(1)])).toMatchObject({ status: 'valid' });
  });

  it('パラメーター自体の省略は正しくないとし、空の SEQUENCE は既定値として扱う（RFC 4055 3.1）', async () => {
    const absent = parseDer(new Uint8Array(tlv(0x30, ALG_OID)));
    expect(await verifySigned({ ...pssCsr.signed, algorithm: absent }, pssCsr.signed.spki)).toEqual({ status: 'invalid', message: 'RSA-PSS のパラメーターが正しくありません（パラメーターがありません）' });
    /** PSS_CSR は SHA-256 で署名しているため、既定値（SHA-1）では一致しない。空の SEQUENCE を既定値として読むことだけを確かめる */
    expect(await verifyWith([])).toMatchObject({ status: 'invalid', message: expect.stringContaining('署名が一致しません') });
  });

  it('trailerField が 1 以外なら、署名の値が正しくても正しくないとする', async () => {
    expect(await verifyWith([HASH, MGF1, SALT, trailer(2)])).toEqual({ status: 'invalid', message: 'RSA-PSS のパラメーターが正しくありません（trailerField は 1 だけが使えます）' });
  });

  it('マスク生成関数が MGF1 でなければ、正しくないとする', async () => {
    const notMgf1 = mgf([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);
    expect(await verifyWith([HASH, notMgf1, SALT])).toMatchObject({ status: 'invalid', message: expect.stringContaining('MGF1 ではありません') });
  });

  it('未知の項目・重複・順番の違いは、正しくないとする', async () => {
    for (const items of [[HASH, MGF1, SALT, tlv(0xa4, tlv(0x02, [0]))], [HASH, MGF1, SALT, SALT], [MGF1, HASH, SALT]]) {
      expect(await verifyWith(items)).toMatchObject({ status: 'invalid', message: expect.stringContaining('項目の順番・重複') });
    }
  });

  it('各項目の型と要素の数まで確かめる', async () => {
    const SHA256_OID = tlv(0x06, [0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);
    const cases: [number[][], string][] = [
      [[HASH, MGF1, tlv(0xa2, tlv(0x04, [0x20]))], 'saltLength が INTEGER ではありません'],
      [[HASH, MGF1, SALT, tlv(0xa3, tlv(0x04, [0x01]))], 'trailerField が INTEGER ではありません'],
      [[tlv(0xa0, tlv(0x30, [...SHA256_OID, ...tlv(0x04, [9])])), MGF1, SALT], 'ハッシュアルゴリズムの形式が違います'],
      [[tlv(0xa0, [...SHA256, ...SHA256]), MGF1, SALT], '[0] の形式が違います'],
      [[HASH, tlv(0xa1, tlv(0x30, [...tlv(0x06, [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x08]), ...SHA256, 0x05, 0x00])), SALT], 'マスク生成関数の形式が違います'],
      [[HASH, MGF1, tlv(0xa2, tlv(0x02, [0xff]))], 'saltLength が負の数です'],
    ];
    for (const [items, message] of cases) {
      expect(await verifyWith(items), message).toEqual({ status: 'invalid', message: `RSA-PSS のパラメーターが正しくありません（${message}）` });
    }
    /** ハッシュの AlgorithmIdentifier の NULL は書いてもよい */
    const withNull = tlv(0x30, [...SHA256_OID, 0x05, 0x00]);
    const MGF1_NULL = tlv(0xa1, tlv(0x30, [...tlv(0x06, [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x08]), ...withNull]));
    expect(await verifyWith([tlv(0xa0, withNull), MGF1_NULL, SALT])).toMatchObject({ status: 'valid' });
  });
});

describe('署名アルゴリズムのパラメーターの有無と型', () => {
  const OID = (bytes: number[]) => tlv(0x06, bytes);
  const ECDSA_SHA256 = OID([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]);
  const RSA_SHA256 = OID([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]);
  const ED25519_OID = OID([0x2b, 0x65, 0x70]);
  /** 署名の対象と署名の値はそのままで、署名アルゴリズムだけを差し替えて検証する */
  const verifyAs = (item: Certificate | Csr, issuerSpki: Uint8Array, algorithm: number[]) =>
    verifySigned({ ...item.signed, algorithm: parseDer(new Uint8Array(tlv(0x30, algorithm))) }, issuerSpki);
  const NULL = [0x05, 0x00];
  const OCTETS = tlv(0x04, [1, 2, 3]);

  it('ECDSA はパラメーターを書けない（RFC 5758 3.2）', async () => {
    expect(await verifyAs(csr, csr.signed.spki, ECDSA_SHA256)).toMatchObject({ status: 'valid' });
    for (const params of [OCTETS, NULL]) {
      expect(await verifyAs(csr, csr.signed.spki, [...ECDSA_SHA256, ...params])).toEqual({ status: 'invalid', message: 'ECDSA の署名アルゴリズムにはパラメーターを書けません' });
    }
  });

  it('RSA の PKCS#1 は NULL か省略だけ（RFC 4055 5）', async () => {
    expect(await verifyAs(root, root.signed.spki, [...RSA_SHA256, ...NULL])).toMatchObject({ status: 'valid' });
    expect(await verifyAs(root, root.signed.spki, RSA_SHA256)).toMatchObject({ status: 'valid' });
    for (const params of [OCTETS, [0x05, 0x01, 0x00]]) {
      expect(await verifyAs(root, root.signed.spki, [...RSA_SHA256, ...params])).toMatchObject({ status: 'invalid', message: expect.stringContaining('NULL か省略だけ') });
    }
  });

  it('Ed25519 はパラメーターを書けない（RFC 8410 3）', async () => {
    expect(await verifyAs(ed, ed.signed.spki, [...ED25519_OID, ...NULL])).toMatchObject({ status: 'invalid', message: expect.stringContaining('Ed25519') });
  });

  it('余分な要素や、OID でない先頭は形式の誤りとする', async () => {
    expect(await verifyAs(csr, csr.signed.spki, [...ECDSA_SHA256, ...NULL, ...NULL])).toMatchObject({ status: 'invalid', message: '署名アルゴリズムの形式が正しくありません' });
    expect(await verifyAs(csr, csr.signed.spki, OCTETS)).toMatchObject({ status: 'invalid', message: '署名アルゴリズムの形式が正しくありません' });
  });
});

describe('発行者の候補と名前の符号化', () => {
  const ca1 = parse(SAME_NAME_CA1) as Certificate;
  const ca2 = parse(SAME_NAME_CA2) as Certificate;
  const sameNameLeaf = parse(SAME_NAME_LEAF) as Certificate;

  it('名前が同じ CA が複数あれば、並び順に関係なく署名を確認できる鍵を探す', async () => {
    for (const certs of [[sameNameLeaf, ca1, ca2], [sameNameLeaf, ca2, ca1]]) {
      expect(await verifyInList(sameNameLeaf, certs)).toMatchObject({ result: { status: 'valid' } });
    }
  });

  it('どの候補でも確認できなければ、候補の数を示して伝える', async () => {
    const copy = parse(SAME_NAME_CA1) as Certificate;
    expect(await verifyInList(sameNameLeaf, [sameNameLeaf, ca1, copy])).toEqual({
      by: '発行者「Same Name CA」の候補 2 枚の公開鍵',
      result: { status: 'invalid', message: expect.stringContaining('発行者の候補 2 枚の、どの公開鍵でも署名を確認できません') },
    });
    /** 候補が1枚なら、これまでどおりその CA の結果を返す */
    expect(await verifyInList(sameNameLeaf, [sameNameLeaf, ca1])).toMatchObject({ by: '発行者「Same Name CA」の公開鍵', result: { status: 'invalid' } });
  });

  it('発行者名と CA の名前の符号化（UTF8String と PrintableString）が違っても、発行者として見つける', async () => {
    const leaf = parse(ENCODING_LEAF) as Certificate;
    const printable = parse(ENCODING_CA_PRINTABLE) as Certificate;
    expect(await verifyInList(leaf, [leaf, printable])).toMatchObject({ by: '発行者「Encoding Test CA」の公開鍵', result: { status: 'valid' } });
  });
});

describe('自己発行の鍵の更新（RFC 5280）', () => {
  const oldCa = parse(ROLLOVER_OLD_CA) as Certificate;
  const newCa = parse(ROLLOVER_NEW_CA) as Certificate;

  it('自分の鍵で確認できなければ、名前が同じ別の CA の鍵でも検証する。自己署名とはしない', async () => {
    expect(newCa.selfIssued).toBe(true);
    const r = await verifyInList(newCa, [newCa, oldCa]);
    expect(r).toMatchObject({ by: expect.stringContaining('自己発行。自分の鍵ではなく、この CA の鍵で署名'), result: { status: 'valid' } });
    expect(r?.selfSigned).toBeFalsy();
  });

  it('別の CA がなければ、自分の鍵での結果（一致しない）を返す', async () => {
    expect(await verifyInList(newCa, [newCa])).toMatchObject({ by: '自分自身の公開鍵（自己署名）', result: { status: 'invalid' } });
  });

  it('自分の鍵で確認できたときだけ、自己署名とする', async () => {
    expect(await verifyInList(oldCa, [newCa, oldCa])).toMatchObject({ by: '自分自身の公開鍵（自己署名）', result: { status: 'valid' }, selfSigned: true });
    expect(await verifyInList(root, [leaf, root])).toMatchObject({ selfSigned: true });
  });
});

describe('発行者の候補の鍵を読み込めないとき', () => {
  /** 指定した公開鍵だけを読み込めないブラウザ（RSA-PSS に限定した鍵など、対応していない鍵を想定） */
  const refusing = (spki: Uint8Array): SubtleCrypto => new Proxy(crypto.subtle, {
    get(target, prop) {
      if (prop === 'importKey') {
        return (format: KeyFormat, data: BufferSource, ...rest: unknown[]) => {
          if (format === 'spki' && sameBytes(new Uint8Array(data as ArrayBuffer), spki)) return Promise.reject(new DOMException('unsupported', 'NotSupportedError'));
          return (target.importKey as (...args: unknown[]) => Promise<CryptoKey>).call(target, format, data, ...rest);
        };
      }
      const value: unknown = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const oldCa = parse(ROLLOVER_OLD_CA) as Certificate;
  const newCa = parse(ROLLOVER_NEW_CA) as Certificate;

  it('自己発行の証明書で、自分の鍵では一致せず発行者の候補の鍵を読み込めなければ、不一致と断定しない', async () => {
    expect(await verifyInList(newCa, [newCa, oldCa], refusing(oldCa.signed.spki))).toEqual({
      by: expect.stringContaining('自己発行。自分の鍵では一致しません'),
      result: { status: 'unsupported', message: expect.stringContaining('自分の公開鍵では一致せず、発行者の候補の公開鍵では検証できません') },
    });
    /** 読み込めれば、これまでどおり旧い CA の鍵で確認できる */
    expect(await verifyInList(newCa, [newCa, oldCa], refusing(new Uint8Array()))).toMatchObject({ result: { status: 'valid' } });
  });

  it('自己発行でない証明書も、候補の鍵を読み込めなければ「検証できない」とする', async () => {
    const [ca1, ca2, leaf] = [SAME_NAME_CA1, SAME_NAME_CA2, SAME_NAME_LEAF].map((pem) => parse(pem) as Certificate) as [Certificate, Certificate, Certificate];
    expect(await verifyInList(leaf, [leaf, ca1, ca2], refusing(ca2.signed.spki))).toMatchObject({ result: { status: 'unsupported' } });
  });
});
