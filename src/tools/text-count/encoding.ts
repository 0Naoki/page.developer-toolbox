/**
 * Shift_JIS（Windows-31J / CP932）と EUC-JP で表現できる文字の一覧。
 * 変換表を持ち歩かずに済むよう、ブラウザ標準の TextDecoder で全コードを復号して作る。
 * Shift_JIS は NEC特殊文字（①、㈱など）やIBM拡張文字（髙、﨑など）も含む。
 */
type Tables = {
  /** Shift_JIS の2バイト文字 */
  sjis: Set<string>;
  /** Shift_JIS の2バイト文字のうち、JIS X 0208 にない機種依存文字（NEC特殊文字・IBM拡張文字） */
  vendor: Map<string, VendorKind>;
  /** EUC-JP の2バイト文字（JIS X 0208 と、その NEC・IBM の拡張） */
  euc2: Set<string>;
  /** EUC-JP の3バイト文字（JIS X 0212 補助漢字） */
  euc3: Set<string>;
};

export type VendorKind = 'NEC特殊文字' | 'NEC選定IBM拡張文字' | 'IBM拡張文字';

let tables: Tables | null = null;

const decodable = (ch: string) => ch.length >= 1 && !ch.includes('�');

function getTables(): Tables {
  if (tables) return tables;
  const sjis = new Set<string>();
  const vendor = new Map<string, VendorKind>();
  const sjisDecoder = new TextDecoder('shift_jis');
  const pair = new Uint8Array(2);
  for (let lead = 0x81; lead <= 0xfc; lead++) {
    if (lead > 0x9f && lead < 0xe0) continue;
    /** 0x87 は NEC特殊文字、0xED・0xEE は NEC選定IBM拡張文字、0xFA〜0xFC は IBM拡張文字の領域 */
    const kind: VendorKind | null = lead === 0x87 ? 'NEC特殊文字' : lead === 0xed || lead === 0xee ? 'NEC選定IBM拡張文字' : lead >= 0xfa ? 'IBM拡張文字' : null;
    for (let trail = 0x40; trail <= 0xfc; trail++) {
      if (trail === 0x7f) continue;
      pair[0] = lead;
      pair[1] = trail;
      const ch = sjisDecoder.decode(pair);
      if (ch.length !== 1 || ch === '�') continue;
      /** ∵ や ≒ のように JIS X 0208 の領域にもある文字は、機種依存文字ではない */
      if (kind && !sjis.has(ch) && !vendor.has(ch)) vendor.set(ch, kind);
      sjis.add(ch);
    }
  }
  /** WHATWG Encoding 仕様の符号化規則で追加される対応 */
  sjis.add('−'); /** − (MINUS SIGN) → 0x817C */

  const euc2 = new Set<string>();
  const euc3 = new Set<string>();
  const eucDecoder = new TextDecoder('euc-jp');
  const triple = new Uint8Array(3);
  for (let a = 0xa1; a <= 0xfe; a++) {
    for (let b = 0xa1; b <= 0xfe; b++) {
      pair[0] = a;
      pair[1] = b;
      const ch = eucDecoder.decode(pair);
      if (decodable(ch) && Array.from(ch).length === 1) euc2.add(ch);
      triple[0] = 0x8f;
      triple[1] = a;
      triple[2] = b;
      const ch3 = eucDecoder.decode(triple);
      if (decodable(ch3) && Array.from(ch3).length === 1 && !euc2.has(ch3)) euc3.add(ch3);
    }
  }
  euc2.add('−'); /** − (MINUS SIGN) → 全角マイナス（0xA1DD）として符号化される */

  tables = { sjis, vendor, euc2, euc3 };
  return tables;
}

/** Shift_JIS でのバイト数。表現できない文字は null */
export function sjisBytesOf(ch: string): 1 | 2 | null {
  const cp = ch.codePointAt(0)!;
  if (cp <= 0x7f || (cp >= 0xff61 && cp <= 0xff9f) || cp === 0xa5 || cp === 0x203e) return 1;
  return getTables().sjis.has(ch) ? 2 : null;
}

/**
 * EUC-JP でのバイト数。表現できない文字は null。
 * 半角カナは2バイト（0x8E + 1バイト）、JIS X 0212 の補助漢字は3バイト（0x8F + 2バイト）
 */
export function eucjpBytesOf(ch: string): 1 | 2 | 3 | null {
  const cp = ch.codePointAt(0)!;
  if (cp <= 0x7f || cp === 0xa5 || cp === 0x203e) return 1;
  if (cp >= 0xff61 && cp <= 0xff9f) return 2;
  const t = getTables();
  if (t.euc2.has(ch)) return 2;
  return t.euc3.has(ch) ? 3 : null;
}

/** Shift_JIS（CP932）では表現できるが、JIS X 0208 にない機種依存文字の種類。そうでなければ null */
export const vendorKindOf = (ch: string): VendorKind | null => getTables().vendor.get(ch) ?? null;

/** Shift_JIS・EUC-JP で表現できない理由（よくあるもの） */
export function reasonOf(ch: string): string {
  const cp = ch.codePointAt(0)!;
  if ((cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef)) return '異体字セレクタ（見えない文字）';
  if (/\p{Extended_Pictographic}/u.test(ch)) return '絵文字';
  if (/\p{M}/u.test(ch)) return '結合文字（濁点・アクセントなど）';
  if (/[\p{Zs}\p{Cf}]/u.test(ch)) return '特殊な空白・見えない文字';
  if (cp >= 0x10000) return 'サロゲートペア（U+10000 以上の文字）';
  return '';
}

/**
 * 半角（帳票で1桁として扱う文字）か。
 * Shift_JIS で1バイトになる文字（ASCII・タブなどの制御文字・半角カナ・¥・‾）と同じ範囲にそろえる。
 */
export const isHalfWidth = (ch: string) => sjisBytesOf(ch) === 1;
