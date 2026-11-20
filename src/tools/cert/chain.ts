import type { Certificate } from './logic';
import { keyIdsCompatible, sameName } from './name';

/** 入力順の証明書の名前と鍵識別子による接続の評価。署名は verify.ts で検証する。 */

export type ChainResult = {
  /** i 番目の証明書の発行者が、i+1 番目の証明書のサブジェクトと一致するか */
  links: { from: number; to: number; ok: boolean; reason?: string }[];
  messages: { level: 'good' | 'warn' | 'bad'; text: string }[];
};

/** i が j に発行されたか（発行者とサブジェクトの一致、鍵識別子があればその一致） */
function issuedBy(child: Certificate, parent: Certificate): { ok: boolean; reason?: string } {
  if (!sameName(child.issuer, parent.subject)) return { ok: false, reason: '発行者とサブジェクトが一致しません' };
  if (!keyIdsCompatible(child.authorityKeyId, parent.subjectKeyId)) {
    return { ok: false, reason: '名前は一致しますが、鍵識別子が一致しません（別の鍵の CA です）' };
  }
  return { ok: true };
}

/** 文言に並べるブロックの番号の上限（残りは件数だけにする） */
const MAX_LISTED_BLOCKS = 5;

/**
 * 並べた証明書が、サーバー証明書 → 中間 CA → ルート CA の順につながっているかを調べる（署名は検証しない）
 *
 * @param certs - 読めた証明書（入力の順）。
 * @param options.positions - それぞれの証明書の、入力の中のブロックの位置（0 から。画面のカードの「n 枚目」と同じ番号にする）。
 *   省略すると、証明書の並びの位置を使う。読めないブロックや CSR が間にあると、並びの位置とカードの番号がずれるため渡す。
 * @param options.unreadable - 読めなかったブロックの位置。あれば、つながりを確かめられていないことを伝える。
 */
export function checkChain(certs: Certificate[], options: { positions?: readonly number[]; unreadable?: readonly number[] } = {}): ChainResult {
  const { positions, unreadable = [] } = options;
  /** 文言に入れる「n 枚目」の番号 */
  const nth = (i: number) => (positions?.[i] ?? i) + 1;
  const links = certs.flatMap((c, i) => {
    const parent = certs[i + 1];
    return parent === undefined ? [] : [{ from: i, to: i + 1, ...issuedBy(c, parent) }];
  });
  const messages: ChainResult['messages'] = [];
  if (links.every((l) => l.ok)) {
    if (unreadable.length === 0) {
      messages.push({ level: 'good', text: `${certs.length} 枚の証明書は、正しい順番でつながっています。` });
    } else {
      /** 読めないブロックが途中の中間 CA なら、実際のチェーンは切れている。読めた証明書だけで「正しい」とは言わない */
      const listed = unreadable.slice(0, MAX_LISTED_BLOCKS).map((i) => `${i + 1}`).join('・');
      const rest = unreadable.length > MAX_LISTED_BLOCKS ? `ほか ${unreadable.length - MAX_LISTED_BLOCKS} 件` : '';
      messages.push({
        level: 'warn',
        text: `読めた ${certs.length} 枚の証明書は、この順番でつながっています。ただし、読めないブロック（${listed} 枚目${rest}）は確かめていません。チェーンの途中の証明書なら、正しく読める形で貼り付け直してください。`,
      });
    }
  } else {
    const reversed = [...certs].reverse();
    if (reversed.every((c, i) => {
      const parent = reversed[i + 1];
      return parent === undefined || issuedBy(c, parent).ok;
    })) {
      messages.push({ level: 'warn', text: '順番が逆です。サーバー証明書を先頭に、ルート側を後ろに並べてください。' });
    } else {
      for (const l of links.filter((x) => !x.ok)) {
        messages.push({ level: 'bad', text: `${nth(l.from)} 枚目と ${nth(l.to)} 枚目がつながっていません（${l.reason}）。` });
      }
    }
  }
  certs.forEach((c, i) => {
    /** 名前だけの判定なので「自己署名」とは断定しない。最後の証明書が自己署名かは、署名を検証してから画面で伝える */
    if (c.selfIssued && i < certs.length - 1) {
      messages.push({ level: 'warn', text: `${nth(i)} 枚目は自己発行（発行者名とサブジェクトが一致）の証明書ですが、途中に入っています。` });
    }
  });
  return { links, messages };
}
