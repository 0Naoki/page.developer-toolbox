/**
 * 証明書デコーダーのファイルの分担。
 * - `pem.ts`：入力（PEM・DER・Base64 の本文）の読み取り。秘密鍵は解析せずに拒否する
 * - `name.ts`：名前（発行者・主体）の読み取りと比較
 * - `extensions.ts`：拡張と別名（SAN など）の読み取り
 * - `logic.ts`：証明書と CSR の全体の解析
 * - `validity.ts`：現在時刻に対する有効期間の評価
 * - `chain.ts`：名前と鍵識別子によるチェーンの評価
 * - `fingerprints.ts`：フィンガープリントの計算
 * - `diagnostics.ts`：読み込んだ各ブロックの解析結果を、表示用にまとめる
 * - `verify.ts`：発行者候補の検証と結果の調整
 * - `signatureScheme.ts`：署名アルゴリズムのパラメーターの解析
 * - `issuerCandidates.ts`：名前と鍵識別子による発行者候補の選択
 * - `verifySigned.ts`：指定した公開鍵での署名検証（Web Crypto API）
 * - `CertView.tsx`：内容と検証結果・チェーンの表示
 * - `sample.ts`：「サンプル」のボタンで入れる証明書
 * DER の解析などの共通の部品は src/lib/crypto/ にある。
 */
import { useMemo, useState } from 'react';
import { Notice } from '../../components/Notice';
import { FileDrop } from '../../components/FileDrop';
import { LargeTextInput } from '../../components/LargeTextInput';
import { ToolShell } from '../../components/ToolShell';
import { useFileLoader } from '../../hooks/useFileLoader';
import { diagnoseItems } from './diagnostics';
import { SAMPLE_CERTIFICATE } from './sample';
import { containsPrivateKey } from '../../lib/crypto/privateKey';
import { MAX_INPUT, readFileBytes, readPem, type DerItem } from './pem';
import { CertView, ChainView, CsrView } from './CertView';
import { ErrorText } from '../../components/ErrorMessage';
import { attempt } from '../../lib/errors';

export default function CertTool() {
  /** 証明書は公開情報だが、誤って秘密鍵を貼り付けることがあるため、入力内容は保存しない（useInput を使わない） */
  const [text, setText] = useState('');
  const [file, setFile] = useState<{ name: string; items: DerItem[] } | null>(null);
  const fileLoader = useFileLoader({
    limit: MAX_INPUT,
    /** ファイルを選んだら、読み込めたかどうかに関係なく入力を差し替える（拒否したときに、貼り付けた PEM や前のファイルの結果を残さない） */
    onStart: () => {
      setText('');
      setFile(null);
    },
    /** 読めなかったときは共通の文言（FileInputError）、読めた後の解析の失敗は解析の文言をそのまま表示する */
    decode: (bytes, f) => ({ name: f.name, items: readFileBytes(bytes) }),
    onLoaded: setFile,
  });
  const replaceText = (value: string) => {
    fileLoader.clear();
    setFile(null);
    setText(value);
  };

  const privateKey = !file && containsPrivateKey(text);

  const result = useMemo(() => {
    if (privateKey) return null;
    if (!file && !text.trim()) return null;
    return attempt(() => diagnoseItems(file ? file.items : readPem(text)));
  }, [text, file, privateKey]);

  return (
    <ToolShell
      description="PEM・DER の SSL/TLS 証明書と CSR の中身（有効期限・SAN・鍵など）を表示します。署名は、一緒に貼り付けた発行者の証明書（自己署名なら自分）の公開鍵で検証します。失効（OCSP・CRL）と、信頼するルート証明書までたどれるかは確認しません。入力内容は保存しません。"
    >
      <div className="toolbar">
        <button type="button" className="btn btn-ghost" onClick={() => replaceText(SAMPLE_CERTIFICATE)}>サンプル</button>
      </div>
      {/** 長い入力を普通の textarea で描画すると画面が止まるため、表示を先頭までにする（入力内容は保存しない） */}
      <LargeTextInput limit={MAX_INPUT}
        label="証明書または CSR（PEM）"
        className="code code-mid"
        value={text}
        onChange={replaceText}
        placeholder={'-----BEGIN CERTIFICATE-----\nMIID...\n-----END CERTIFICATE-----\n（チェーンは複数続けて貼り付けられます）'}
      />
      <FileDrop onFile={(f) => void fileLoader.pick(f)} accept=".pem,.crt,.cer,.der,.csr,.req" small>
        {file ? <strong>{file.name}</strong> : <strong>ファイルをドロップ、またはクリックして選択</strong>}
        <span className="muted">.pem・.crt・.cer（PEM・DER）、.csr</span>
      </FileDrop>
      {fileLoader.error && <ErrorText message={fileLoader.error} />}

      {privateKey && (
        <Notice tone="bad">
          秘密鍵が含まれています。秘密鍵は貼り付けないでください（解析も保存もしていません）。
          <button type="button" className="link-btn" onClick={() => replaceText('')}>
            入力を消す
          </button>
        </Notice>
      )}
      {result && !result.ok && <ErrorText message={result.error} />}

      {result?.ok && result.certs.length >= 2 && <ChainView certs={result.certs} positions={result.certPositions} unreadable={result.unreadable} />}

      {result?.ok &&
        result.cards.map((p) => (
          <section key={p.index} className="panel cert-card">
            <h2 className="panel-title">
              {result.total > 1 && `${p.index + 1} 枚目：`}
              {p.ok ? (p.item.kind === 'csr' ? 'CSR（証明書署名要求）' : '証明書') : '読めません'}
            </h2>
            {p.ok ? p.item.kind === 'certificate' ? <CertView cert={p.item} certs={result.certs} /> : <CsrView csr={p.item} /> : <ErrorText message={p.error} />}
          </section>
        ))}
      {result?.ok && result.errorCount > result.maxErrors && (
        <ErrorText message={`読み取れないブロックは全 ${result.errorCount} 件です（先頭 ${result.maxErrors} 件を表示）。`} />
      )}

      <details className="cert-help stack">
        <summary>サーバーの証明書を取り出すには</summary>
        <p>このツールは外部と通信しないため、サイトから直接は取得できません。次のどちらかで取り出して貼り付けてください。</p>
        <pre className="code code-pre">openssl s_client -connect example.com:443 -servername example.com -showcerts &lt; /dev/null</pre>
        <p className="hint">ブラウザでは、アドレスバーの鍵のアイコンから証明書を表示し、「エクスポート」（PEM 形式）で保存できます。</p>
      </details>
    </ToolShell>
  );
}

