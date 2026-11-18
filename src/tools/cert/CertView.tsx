import { useCallback, useMemo } from 'react';
import { CopyButton } from '../../components/CopyButton';
import { toUpperHex } from '../../lib/crypto/asn1';
import { Badge } from '../../components/Badge';
import { Notice } from '../../components/Notice';
import { useAsyncFor } from '../../hooks/useAsyncFor';
import { useAnnounce } from '../../components/LiveAnnouncer';
import { useNow } from '../../hooks/useNow';
import { ClippedText } from '../../components/ClippedText';
import { KvRow } from '../../components/KvRow';
import { ListRest } from '../../components/ListRest';
import { LIST_PREVIEW_LIMIT, previewList } from '../../lib/listPreview';
import { formatJstLabeled } from '../../lib/time/dateTimeFormat';
import { checkChain } from './chain';
import { fingerprints } from './fingerprints';
import { validityOf } from './validity';
import { type Certificate, type Csr } from './logic';
import { verifyInList, type ItemVerification } from './verify';
import type { Extension } from './extensions';

/** 証明書・CSR の内容、署名の検証結果、チェーンの表示 */

/**
 * 一覧（SAN・拡張・拡張の値・属性）は先頭 LIST_PREVIEW_LIMIT 件を、1つの値は VALUE_PREVIEW_LIMIT 単位までを表示する。
 * 件数の超過は ListRest、1つの値の長さの超過は ClippedText で示し、どちらも全件・全文をコピーで取り出せる
 */


function useFingerprints(der: Uint8Array) {
  /** カードは作り直されないため、どの証明書の結果かを組で持ち、内容を変えた直後の描画でも前の値を表示しない */
  const result = useAsyncFor(der, fingerprints, () => null);
  return result.ready ? result.value : null;
}

const NO_CERTS: Certificate[] = [];

/**
 * 同じ証明書と発行者の候補の組の検証は、1回だけ行う。
 * チェーンの最後の自己発行の証明書は、チェーンの表示（自己署名か）とカードの表示の両方で検証するため。
 * 解析の結果（証明書・一覧）を作り直すと別の組になり、古い結果は WeakMap から自然に消える
 */
const verifications = new WeakMap<Certificate | Csr, WeakMap<Certificate[], Promise<ItemVerification | null>>>();
function verifyOnce(item: Certificate | Csr, certs: Certificate[]): Promise<ItemVerification | null> {
  let byCerts = verifications.get(item);
  if (!byCerts) verifications.set(item, (byCerts = new WeakMap()));
  let pending = byCerts.get(certs);
  if (!pending) byCerts.set(certs, (pending = verifyInList(item, certs)));
  return pending;
}

/** 署名の検証（非同期）。'pending' は検証中、null は発行者の証明書がなく検証できない */
export function useVerification(item: Certificate | Csr, certs: Certificate[]): ItemVerification | null | 'pending' {
  /** カードは作り直されないため、どの証明書・チェーンの結果かを組で持ち、内容を変えた直後の描画でも前の「正しい」を表示しない */
  const key = useMemo(() => ({ item, certs }), [item, certs]);
  const result = useAsyncFor(key, (k) => verifyOnce(k.item, k.certs), () => null);
  return result.ready ? result.value : 'pending';
}

function VerificationRow({ v }: { v: ItemVerification | null | 'pending' }) {
  /** 署名の検証の結果を読み上げる（検証は非同期で、表示が後から変わるため） */
  useAnnounce(v !== null && v !== 'pending' ? `署名の検証：${v.result.message}` : null);
  return (
    <tr>
      <th>署名の検証</th>
      <td>
        {v === 'pending' && <span className="muted">確認中…</span>}
        {v === null && <span className="muted">発行者の証明書がないため検証できません（発行者の証明書を続けて貼り付けると検証します）</span>}
        {v !== null && v !== 'pending' && (
          <>
            <Badge tone={v.result.status === 'valid' ? 'good' : v.result.status === 'invalid' ? 'bad' : 'neutral'}>
              {v.result.status === 'valid' ? '✓ 正しい' : v.result.status === 'invalid' ? '✗ 一致しません' : '検証できません'}
            </Badge>{' '}
            {v.result.message}
            <div className="muted">{v.by}で検証</div>
          </>
        )}
      </td>
      <td />
    </tr>
  );
}

function ValidityBadge({ cert }: { cert: Certificate }) {
  /** 表示したまま有効開始・期限の時刻を過ぎても判定が変わるよう、現在時刻を毎秒更新する（この表示だけを描き直す） */
  const now = useNow();
  const v = validityOf(cert, now);
  switch (v.status) {
    case 'expired':
      return <Badge tone="bad">期限切れ（{v.daysLeft === 0 ? '本日' : `${-v.daysLeft} 日前`}）</Badge>;
    case 'notYet':
      return <Badge tone="bad">まだ有効ではありません</Badge>;
    case 'soon':
      return <Badge tone="bad">あと {v.daysLeft} 日で期限切れ</Badge>;
    default:
      return <Badge tone="good">有効（残り {v.daysLeft} 日）</Badge>;
  }
}

/**
 * 発行者名とサブジェクトが一致するだけでは、自己署名とは言えない（RFC 5280 の自己発行と自己署名は別）。
 * 自分の公開鍵で署名を検証できたときだけ「自己署名」と表示する
 */
function SelfIssuedBadge({ v }: { v: ItemVerification | null | 'pending' }) {
  const status = v !== null && v !== 'pending' ? v.result.status : null;
  if (status === 'valid' && v !== null && v !== 'pending' && v.selfSigned) return <Badge>自己署名</Badge>;
  /** 鍵の更新などで、名前が同じ別の CA の鍵で署名されている */
  if (status === 'valid') return <Badge>自己発行（別の鍵で署名）</Badge>;
  if (status === 'invalid') return <Badge tone="bad">自己発行（署名が一致しない）</Badge>;
  return <Badge>自己発行</Badge>;
}

/** 最後の証明書が自己発行なら、自分の公開鍵での署名の検証結果に合わせて、ルート証明書かどうかを伝える */
function SelfSignedRootNotice({ cert, certs }: { cert: Certificate; certs: Certificate[] }) {
  const v = useVerification(cert, certs);
  if (v === 'pending') return <Notice>最後の証明書は自己発行（発行者名とサブジェクトが一致）です。自己署名かを確認しています…</Notice>;
  if (v !== null && v.result.status === 'valid' && !v.selfSigned) {
    return <Notice>最後の証明書は自己発行（発行者名とサブジェクトが一致）ですが、自分ではなく、一覧にある名前が同じ別の CA の鍵で署名されています（鍵の更新など）。自己署名のルート証明書ではありません。</Notice>;
  }
  if (v !== null && v.result.status === 'valid') {
    return <Notice tone="good">最後の証明書は自己署名のルート証明書です（自分の公開鍵で署名を確認しました。通常、サーバーはルート証明書を送らなくてもかまいません）。</Notice>;
  }
  if (v !== null && v.result.status === 'invalid') {
    return <Notice tone="bad" message={`最後の証明書は発行者名とサブジェクトが一致しますが、自分の公開鍵で署名を確認できません（${v.result.message}）。`} />;
  }
  return <Notice>最後の証明書は自己発行（発行者名とサブジェクトが一致）です。署名を検証できないため、自己署名かは確認できません。</Notice>;
}

export function CertView({ cert, certs }: { cert: Certificate; certs: Certificate[] }) {
  const fp = useFingerprints(cert.der);
  const verification = useVerification(cert, certs);
  return (
    <>
      <div className="status-row">
        <ValidityBadge cert={cert} />
        {cert.ca && <Badge>CA 証明書</Badge>}
        {cert.selfIssued && <SelfIssuedBadge v={verification} />}
        {cert.version !== 3 && <Badge>バージョン {cert.version}</Badge>}
      </div>
      <table className="kv cert-table">
        <tbody>
          <KvRow label="サブジェクト" value={cert.subject.text} copy={false} />
          <KvRow label="発行者" value={cert.issuer.text} copy={false} />
          <KvRow label="有効期間（開始）" value={formatJstLabeled(cert.notBefore)} copy={false} />
          <KvRow label="有効期間（終了）" value={formatJstLabeled(cert.notAfter)} copy={false} />
          <SanRow cert={cert} />
          <KvRow label="公開鍵" value={cert.publicKey.detail} copy={false} />
          <KvRow label="署名アルゴリズム" value={cert.signatureAlgorithm} copy={false} />
          <VerificationRow v={verification} />
          {cert.keyUsage.length > 0 && <KvRow label="鍵の用途" value={cert.keyUsage.join('、')} copy={false} />}
          {cert.extKeyUsage.length > 0 && <KvRow label="拡張鍵用途" value={cert.extKeyUsage.join('、')} copy={false} />}
          <KvRow label="シリアル番号" value={cert.serial} />
          <KvRow label="SHA-256" value={fp?.sha256 ?? '計算中…'} copy={!!fp} />
          <KvRow label="SHA-1" value={fp?.sha1 ?? '計算中…'} copy={!!fp} />
        </tbody>
      </table>
      <Extensions item={cert} />
    </>
  );
}

export function CsrView({ csr }: { csr: Csr }) {
  const verification = useVerification(csr, NO_CERTS);
  const attributes = previewList(csr.hiddenAttributes, LIST_PREVIEW_LIMIT);
  return (
    <>
      <table className="kv cert-table">
        <tbody>
          <KvRow label="サブジェクト" value={csr.subject.text} copy={false} />
          <SanRow cert={csr} />
          <KvRow label="公開鍵" value={csr.publicKey.detail} copy={false} />
          <KvRow label="署名アルゴリズム" value={csr.signatureAlgorithm} copy={false} />
          <VerificationRow v={verification} />
          {attributes.shown.map((a, i) => (
            <KvRow key={i} label="属性" value={a} copy={false} />
          ))}
          {attributes.rest > 0 && (
            <tr>
              <th>属性</th>
              <td><ListRest rest={attributes.rest} shown={attributes.shown.length} copyText={csr.hiddenAttributes.join('\n')} copyLabel="すべての属性をコピー" /></td>
              <td />
            </tr>
          )}
        </tbody>
      </table>
      <Extensions item={csr} />
    </>
  );
}

function SanRow({ cert }: { cert: Certificate | Csr }) {
  const san = previewList(cert.san, LIST_PREVIEW_LIMIT);
  return (
    <tr>
      <th>SAN</th>
      <td className="mono">
        {cert.san.length === 0 ? (
          <span className="muted">なし（今のブラウザは CN ではなく SAN のドメイン名を確認します）</span>
        ) : (
          <ul className="san-list">
            {san.shown.map((g, i) => (
              <li key={i}>
                <span className="muted">{g.type}</span> <ClippedText text={g.value} />
              </li>
            ))}
          </ul>
        )}
      </td>
      <td>
        <ListRest rest={san.rest} shown={san.shown.length} copyText={san.rest > 0 ? cert.san.map((g) => `${g.type}: ${g.value}`).join('\n') : undefined} copyLabel="すべての SAN をコピー" />
      </td>
    </tr>
  );
}

function Extensions({ item }: { item: Certificate | Csr }) {
  const copyAll = useCallback(() => item.extensions.map((e) => `${e.name}（${e.oid}）${e.critical ? ' 重要' : ''}\n${e.values.map((v) => `  ${v}`).join('\n')}\n生バイト：${toUpperHex(e.raw, ' ')}`).join('\n'), [item]);
  if (item.extensions.length === 0) return null;
  /** 拡張の個数にも上限を設ける（1 MiB の入力で数万個の拡張を含む証明書を作れるため） */
  const extensions = previewList(item.extensions, LIST_PREVIEW_LIMIT);
  return (
    <details className="stack">
      <summary>すべての拡張（{item.extensions.length}）</summary>
      <table className="kv cert-table">
        <tbody>
          {extensions.shown.map((e, i) => <ExtensionRow key={i} extension={e} />)}
        </tbody>
      </table>
      <ListRest
        rest={extensions.rest}
        shown={extensions.shown.length}
        copyText={copyAll}
        copyLabel="すべての拡張をコピー"
      />
    </details>
  );
}

/** 表示は抜粋だけを作り、全件・生バイトの文字列化はコピー操作まで待つ。 */
function ExtensionRow({ extension: e }: { extension: Extension }) {
  const values = previewList(e.values, LIST_PREVIEW_LIMIT);
  const copyValues = useCallback(() => e.values.join('\n'), [e]);
  const copyRaw = useCallback(() => toUpperHex(e.raw, ' '), [e]);
  return (
    <tr>
      <th>
        {e.name}
        {e.critical && <Badge small>重要</Badge>}
        <div className="muted mono ext-oid"><ClippedText text={e.oid} /></div>
      </th>
      <td className="mono">
        {values.shown.map((v, j) => <div key={j}><ClippedText text={v} /></div>)}
        <ListRest rest={values.rest} shown={values.shown.length} copyText={copyValues} copyLabel={`${e.name}の値をすべてコピー`} />
        <CopyButton text={e.raw.length > 0 ? copyRaw : ''} label={`${e.name}の生バイトを全文コピー`} />
      </td>
    </tr>
  );
}

/**
 * 証明書チェーンの診断。
 *
 * @param positions - それぞれの証明書の、入力の中のブロックの位置（文言の「n 枚目」をカードの番号とそろえる）。
 * @param unreadable - 読めなかったブロックの位置。
 */
export function ChainView({ certs, positions, unreadable }: { certs: Certificate[]; positions: readonly number[]; unreadable: readonly number[] }) {
  const result = useMemo(() => checkChain(certs, { positions, unreadable }), [certs, positions, unreadable]);
  const last = certs.at(-1);
  return (
    <section className="cert-chain stack">
      <h2 className="section-title">証明書チェーン</h2>
      {result.messages.map((m, i) => (
        <Notice key={i} tone={m.level} message={m.text} />
      ))}
      {last?.selfIssued && <SelfSignedRootNotice cert={last} certs={certs} />}
      <ol className="chain-list">
        {certs.map((c, i) => {
          const link = result.links[i];
          return (
            <li key={i}>
              <span className="mono"><ClippedText text={c.subject.attrs.find((a) => a.short === 'CN')?.value ?? c.subject.text} /></span>
              {link && (
                <span className={link.ok ? 'chain-ok' : 'chain-ng'}>
                  {link.ok ? ' ← 次の証明書が発行' : ' ✗ 次の証明書とつながっていません'}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
