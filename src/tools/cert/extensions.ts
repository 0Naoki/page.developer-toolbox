import { assertTag, isContext, isUniversal, parseDer, rawOf, readBitString, readBoolean, readInteger, SMALL_INTEGER_BYTES, readOid, readString, TAG, toUpperHex, valueOf, type Node } from '../../lib/crypto/asn1';
import { readName } from './name';
import { formatIpv6Groups } from '../../lib/ipv6';

/**
 * 証明書・CSR の拡張と、別名（SAN など）の読み取り。表示に使う文字列にする。
 * 証明書と CSR の全体の解析は logic.ts で行う。
 */

const KEY_USAGES = [
  'デジタル署名（digitalSignature）',
  '否認防止（nonRepudiation）',
  '鍵の暗号化（keyEncipherment）',
  'データの暗号化（dataEncipherment）',
  '鍵共有（keyAgreement）',
  '証明書の署名（keyCertSign）',
  'CRL の署名（cRLSign）',
  '暗号化のみ（encipherOnly）',
  '復号のみ（decipherOnly）',
];

const EXT_KEY_USAGES: Record<string, string> = {
  '1.3.6.1.5.5.7.3.1': 'サーバー認証（serverAuth）',
  '1.3.6.1.5.5.7.3.2': 'クライアント認証（clientAuth）',
  '1.3.6.1.5.5.7.3.3': 'コード署名（codeSigning）',
  '1.3.6.1.5.5.7.3.4': 'メールの保護（emailProtection）',
  '1.3.6.1.5.5.7.3.8': 'タイムスタンプ（timeStamping）',
  '1.3.6.1.5.5.7.3.9': 'OCSP の署名（OCSPSigning）',
  '2.5.29.37.0': 'すべての用途（anyExtendedKeyUsage）',
};

const POLICIES: Record<string, string> = {
  '2.23.140.1.2.1': 'ドメイン認証（DV）',
  '2.23.140.1.2.2': '組織認証（OV）',
  '2.23.140.1.2.3': '個人認証（IV）',
  '2.23.140.1.1': 'EV',
  '2.5.29.32.0': 'すべてのポリシー（anyPolicy）',
};

const EXTENSIONS: Record<string, string> = {
  '2.5.29.14': 'サブジェクト鍵識別子',
  '2.5.29.15': '鍵の用途（Key Usage）',
  '2.5.29.17': 'サブジェクトの別名（SAN）',
  '2.5.29.19': '基本制約（Basic Constraints）',
  '2.5.29.31': 'CRL の配布点',
  '2.5.29.32': '証明書ポリシー',
  '2.5.29.35': '発行者の鍵識別子',
  '2.5.29.37': '拡張鍵用途（Extended Key Usage）',
  '1.3.6.1.5.5.7.1.1': '発行者の情報へのアクセス（AIA）',
  '1.3.6.1.4.1.11129.2.4.2': '証明書の透明性（CT）のタイムスタンプ',
};

/** OID を、表にある名前にする（表になければ OID のまま）。署名アルゴリズムの名前（logic.ts）にも使う */
export const oidName = (table: Record<string, string>, oid: string) => table[oid] ?? oid;

/** IPv6 アドレス（16バイト）を、サブネット計算と同じ推奨表記（RFC 5952。src/lib/ipv6.ts）にする */
export function formatIpv6Bytes(v: Uint8Array): string {
  const view = new DataView(v.buffer, v.byteOffset, v.byteLength);
  return formatIpv6Groups(Array.from({ length: 8 }, (_, i) => view.getUint16(i * 2)));
}

export type GeneralName = { type: 'DNS' | 'IP' | 'メール' | 'URI' | 'ディレクトリ名' | 'その他'; value: string };

function readGeneralName(n: Node | undefined): GeneralName {
  if (n === undefined) throw new Error('別名の値を読めません');
  if (n.tagClass !== 'context') return { type: 'その他', value: toUpperHex(rawOf(n)) };
  const v = valueOf(n);
  const ascii = () => readString({ ...n, tag: TAG.IA5_STRING });
  switch (n.tag) {
    case 1:
      return { type: 'メール', value: ascii() };
    case 2:
      return { type: 'DNS', value: ascii() };
    case 6:
      return { type: 'URI', value: ascii() };
    case 7:
      if (v.length === 4) return { type: 'IP', value: Array.from(v).join('.') };
      if (v.length === 16) return { type: 'IP', value: formatIpv6Bytes(v) };
      return { type: 'IP', value: toUpperHex(v, ':') };
    case 4:
      return { type: 'ディレクトリ名', value: n.children[0] ? readName(n.children[0]).text : '' };
    default:
      return { type: 'その他', value: `[${n.tag}] ${toUpperHex(v).slice(0, 64)}` };
  }
}

/** 拡張 */

export type Extension = {
  oid: string; name: string; critical: boolean; values: string[];
  /** OCTET STRING の全文。元の入力を参照し、未知・不正・重複の拡張も失わない。 */
  raw: Uint8Array;
};

export type ExtensionSummary = {
  extensions: Extension[];
  san: GeneralName[];
  keyUsage: string[];
  extKeyUsage: string[];
  /** 基本制約がなければ null */
  ca: boolean | null;
  pathLen: number | null;
  subjectKeyId: string | null;
  authorityKeyId: string | null;
};

export function readExtensions(list: Node | undefined): ExtensionSummary {
  const summary: ExtensionSummary = {
    extensions: [],
    san: [],
    keyUsage: [],
    extKeyUsage: [],
    ca: null,
    pathLen: null,
    subjectKeyId: null,
    authorityKeyId: null,
  };
  if (!list) return summary;
  /**
   * 同じ拡張は1つの証明書に1回まで（RFC 5280 4.2）。2回目以降は解読しない。
   * - 解読すると、後の値が前の値（SAN・CA かどうかなど）を黙って上書きする
   * - 壊れた同じ拡張を大量に並べると、読めない値ごとに例外を作り、7万件で1秒以上、画面を止める
   * 例外を作る解読は、拡張の種類（OID）ごとに1回までになる
   */
  const seen = new Set<string>();
  for (const ext of list.children) {
    const oid = readOid(assertTag(ext.children[0], TAG.OID, '拡張'));
    const critical = isUniversal(ext.children[1], TAG.BOOLEAN) ? readBoolean(ext.children[1]) : false;
    const octets = assertTag(ext.children[ext.children.length - 1], TAG.OCTET_STRING, '拡張の値');
    const value = valueOf(octets);
    let values: string[];
    if (seen.has(oid)) {
      values = [`（同じ拡張が重複しています。RFC 5280 では1つの証明書に1回までのため、2つ目以降は読みません：${hexPreview(value)}）`];
    } else {
      seen.add(oid);
      try {
        values = readExtensionValue(oid, value, summary);
      } catch {
        values = [`（読めない値：${hexPreview(value)}）`];
      }
    }
    summary.extensions.push({ oid, name: oidName(EXTENSIONS, oid), critical, values, raw: value });
  }
  return summary;
}

/** 表示する値の先頭のバイト数 */
export const HEX_PREVIEW_BYTES = 32;

/** 値の先頭だけを16進数にする（大きな値の全体を文字列にしない） */
function hexPreview(value: Uint8Array): string {
  return toUpperHex(value.subarray(0, HEX_PREVIEW_BYTES)) + (value.length > HEX_PREVIEW_BYTES ? '…' : '');
}

function readExtensionValue(oid: string, value: Uint8Array, s: ExtensionSummary): string[] {
  const node = () => parseDer(value);
  switch (oid) {
    case '2.5.29.17':
      s.san = node().children.map(readGeneralName);
      return s.san.map((g) => `${g.type}: ${g.value}`);
    case '2.5.29.19': {
      const seq = node();
      s.ca = isUniversal(seq.children[0], TAG.BOOLEAN) ? readBoolean(seq.children[0]) : false;
      const last = seq.children[seq.children.length - 1];
      s.pathLen = isUniversal(last, TAG.INTEGER) ? Number(readInteger(last, SMALL_INTEGER_BYTES)) : null;
      return [`CA：${s.ca ? 'はい' : 'いいえ'}`, ...(s.pathLen !== null ? [`下位の CA の段数の上限：${s.pathLen}`] : [])];
    }
    case '2.5.29.15': {
      const { bytes } = readBitString(node());
      s.keyUsage = KEY_USAGES.filter((_, i) => (bytes[i >> 3] ?? 0) & (0x80 >> (i & 7)));
      return s.keyUsage;
    }
    case '2.5.29.37':
      s.extKeyUsage = node().children.map((c) => oidName(EXT_KEY_USAGES, readOid(c)));
      return s.extKeyUsage;
    case '2.5.29.14':
      s.subjectKeyId = toUpperHex(valueOf(node()), ':');
      return [s.subjectKeyId];
    case '2.5.29.35': {
      const keyId = node().children.find((c) => isContext(c, 0));
      s.authorityKeyId = keyId ? toUpperHex(valueOf(keyId), ':') : null;
      return s.authorityKeyId ? [s.authorityKeyId] : ['（鍵識別子なし）'];
    }
    case '2.5.29.31':
      /** DistributionPoint の distributionPoint [0] → fullName [0] → GeneralName */
      return node().children.flatMap((dp) =>
        (dp.children.find((c) => isContext(c, 0))?.children.find((c) => isContext(c, 0))?.children ?? []).map((g) => {
          const name = readGeneralName(g);
          return `${name.type}: ${name.value}`;
        }),
      );
    case '1.3.6.1.5.5.7.1.1':
      return node().children.map((ad) => {
        const method = readOid(assertTag(ad.children[0], TAG.OID, 'アクセス方式'));
        const label = method === '1.3.6.1.5.5.7.48.1' ? 'OCSP' : method === '1.3.6.1.5.5.7.48.2' ? 'CA の証明書' : method;
        return `${label}: ${readGeneralName(ad.children[1]).value}`;
      });
    case '2.5.29.32':
      return node().children.map((p) => {
        const id = readOid(assertTag(p.children[0], TAG.OID, '証明書ポリシー'));
        return POLICIES[id] ? `${POLICIES[id]}（${id}）` : id;
      });
    case '1.3.6.1.4.1.11129.2.4.2':
      return ['（内容は表示しません）'];
    default:
      return [toUpperHex(value.subarray(0, HEX_PREVIEW_BYTES), ' ') + (value.length > HEX_PREVIEW_BYTES ? ' …' : '')];
  }
}
