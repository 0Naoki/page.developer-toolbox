/**
 * JWTデコーダーのファイルの分担。
 * - `logic.ts`：トークンの分解と、時刻クレームの表示用の値
 * - `diagnostics.ts`：時刻クレームの判定と、ヘッダ・クレームの警告
 * - `alg.ts`：署名アルゴリズム（RFC 7518）と Web Crypto API の指定の対応
 * - `keys.ts`：鍵（秘密鍵・公開鍵・JWK Set）の読み込みと安全検査
 * - `verify.ts`：署名の検証（Web Crypto API を使う非同期処理）
 * - `useVerification.ts`：鍵の入力の読み込みと、署名の検証の結果を画面で使うフック
 * トークン・鍵は保存しない（useInput を使わない）。
 */
import { useMemo, useState } from 'react';
import { Pane } from '../../components/Pane';
import { Badge } from '../../components/Badge';
import { Notice } from '../../components/Notice';
import { CopyButton } from '../../components/CopyButton';
import { LargeTextInput } from '../../components/LargeTextInput';
import { Segmented } from '../../components/Segmented';
import { ToolShell } from '../../components/ToolShell';
import { detailPreview, TEXT_PREVIEW_LIMIT } from '../../lib/text/textPreview';
import { useNow } from '../../hooks/useNow';
import { decodeJwe, judgeJwt, parseJwt, type DecodedJwt, type ParsedJwt } from './logic';
import { isHmacAlg } from './alg';
import type { SecretEncoding } from './keys';
import { useVerification, type VerificationState } from './useVerification';
import { ErrorBox, ErrorText } from '../../components/ErrorMessage';
import { attempt } from '../../lib/errors';
import { previewList } from '../../lib/listPreview';
import { ListRest } from '../../components/ListRest';
import { TextOutputPreview } from '../../components/FormattedOutput';
import { ClippedText } from '../../components/ClippedText';

export default function JwtDecoder() {
  /** トークンは機密情報になり得るため、どこにも保存しない（useInput を使わず、メモリ内だけで持つ） */
  const [token, setToken] = useState('');
  const result = useMemo(() => {
    if (!token.trim()) return null;
    return attempt(() => {
      const jwe = decodeJwe(token);
      return jwe ? { jwe } : { data: parseJwt(token) };
    });
  }, [token]);

  return (
    <ToolShell
      description="中身を表示し、秘密鍵（HS256 など）か公開鍵（RS256・ES256 など）を入力すると署名を検証します。トークンと鍵はブラウザ内でのみ処理され、保存もされません。"
    >
      <Pane title="トークン">
        {/** 長いトークン（改行のない1行）を普通の textarea で描画すると、画面が数十秒止まることがあるため、表示を先頭までにする */}
        <LargeTextInput label="トークン" className="code code-short" value={token} onChange={setToken} placeholder="eyJhbGciOi...（Bearer 付きでも可）" />
      </Pane>

      {result && !result.ok && (
        <ErrorBox title="デコードできません" message={result.error} code />
      )}

      {result?.ok && 'jwe' in result && result.jwe && (
        <>
          <Notice tone="warn">
            JWE（暗号化されたトークン）です。中身（ペイロード）は暗号化されているため、復号の鍵がないと表示できません。読めるのはヘッダだけです。
          </Notice>
          <div className="split">
            <JsonPane title="ヘッダ" text={result.jwe.headerJson} />
          </div>
        </>
      )}

      {result?.ok && 'data' in result && result.data && <Decoded parsed={result.data} />}
    </ToolShell>
  );
}

function Decoded({ parsed }: { parsed: ParsedJwt }) {
  /** 期限切れの判定と「あと何時間」を、貼り付けた時点で止めずに更新する。トークンの解析は毎秒やり直さない */
  const now = useNow();
  const data = useMemo(() => judgeJwt(parsed, now), [parsed, now]);
  const verification = useVerification(parsed);
  /** 重複したキーなどの警告は多くなり得るため、先頭5件と残りの件数にする */
  const warnings = previewList(data.warnings, 5);

  return (
    <>
      <div className="status-row">
        {/** exp の判定だけだと、nbf が未来のトークンも「有効期限内」とだけ表示されて使えるように見えるため */}
        {data.notYetValid === true && <Badge tone="bad">有効開始前（nbf）</Badge>}
        {data.notYetValid === 'invalid' && <Badge tone="bad">nbf が不正</Badge>}
        {data.expired === null && <Badge>exp なし</Badge>}
        {data.expired === 'invalid' && <Badge tone="bad">exp が不正</Badge>}
        {data.expired === true && <Badge tone="bad">期限切れ</Badge>}
        {data.expired === false && <Badge tone="good">有効期限内</Badge>}
        {/** alg はトークン由来で長さに制限がないため、バッジは抜粋にする（全文はヘッダからコピーできる） */}
        {typeof data.header.alg === 'string' && <Badge>alg: {detailPreview(data.header.alg)}</Badge>}
        {verification.result?.status === 'valid' && <Badge tone="good">署名は正しい</Badge>}
        {verification.result?.status === 'invalid' && <Badge tone="bad">署名が一致しない</Badge>}
        {!verification.result && <Badge>署名は未検証</Badge>}
      </div>

      {data.headerWarnings.map((w) => (
        <Notice key={w.message} tone={w.tone} message={w.message} />
      ))}

      {data.timeClaims.length > 0 && (
        <table className="kv">
          <tbody>
            {data.timeClaims.map((c) => (
              <tr key={c.name}>
                <th>{c.label}</th>
                <td>
                  {c.jst === null ? (
                    <span className="muted">日時に変換できない値です</span>
                  ) : (
                    <>
                      <span className="mono">{c.jst}</span> <span className="muted">JST（{c.relative}）</span>
                    </>
                  )}
                </td>
                {/** 元の表記は小数の桁に制限がないため、長ければ先頭だけにして全文をコピーできるようにする */}
                <td className="mono muted"><ClippedText text={c.epochText} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {data.claims.length > 0 && (
        <table className="kv jwt-claims">
          <tbody>
            {data.claims.map((c) => (
              <tr key={c.name}>
                <th className="mono">{c.name}</th>
                <td>
                  <span className="mono"><ClippedText text={c.value} limit={TEXT_PREVIEW_LIMIT} /></span>
                  <br />
                  <span className="muted">{c.label}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/** 同じ行に同じキーが3回以上あると同じ文言が並ぶため、key に番号を含める */}
      {warnings.shown.map((w, i) => (
        <Notice key={`${i}:${w}`} tone="warn" message={w} />
      ))}
      <ListRest rest={warnings.rest} shown={warnings.shown.length} />

      <VerifyPanel data={data} verification={verification} />

      <div className="split">
        <JsonPane title="ヘッダ" text={data.headerJson} />
        <JsonPane title="ペイロード" text={data.payloadJson} />
      </div>
    </>
  );
}

function VerifyPanel({ data, verification: v }: { data: DecodedJwt; verification: VerificationState }) {
  const alg = typeof data.header.alg === 'string' ? data.header.alg : '';
  if (alg.toLowerCase() === 'none') return null;
  const hmac = isHmacAlg(alg);
  /** 見出しに入れる alg は抜粋にする */
  const algLabel = detailPreview(alg);

  return (
    <section className="panel jwt-verify">
      <h2 className="panel-title">署名の検証</h2>
      {hmac ? (
        <>
          <div className="toolbar">
            <Segmented<SecretEncoding>
              label="秘密鍵の形式"
              value={v.encoding}
              onChange={v.setEncoding}
              options={[
                { value: 'utf-8', label: 'テキスト（UTF-8）' },
                { value: 'base64', label: 'Base64' },
              ]}
            />
          </div>
          <label className="field">
            <span className="field-label">秘密鍵（{algLabel}。保存されません）</span>
            <input
              aria-label="秘密鍵"
              className="input mono"
              value={v.keyText}
              onChange={(e) => v.setKeyText(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
          </label>
        </>
      ) : (
        /**
         * 鍵の上限（MAX_KEY）は読み込むときの検査で、貼り付けの量は制限しない。証明書のチェーンなど長い入力を普通の textarea で
         * 描画すると画面が止まるため、LargeTextInput にする。欄の上に「元に戻す」などのボタンが並ぶため、label ではなく div で囲む
         */
        <div className="field">
          <span className="field-label">公開鍵（{algLabel || 'alg なし'}。PEM・証明書・JWK・JWK Set。保存されません）</span>
          <LargeTextInput
            label="公開鍵"
            className="code code-short"
            value={v.keyText}
            onChange={v.setKeyText}
            placeholder={'-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\nまたは {"kty":"RSA","n":"...","e":"AQAB"}'}
          />
        </div>
      )}

      {v.keyError && <ErrorText message={v.keyError} />}
      {v.keyWarning && <Notice tone="warn" message={v.keyWarning} />}
      {v.result && (
        <Notice
          tone={v.result.status === 'valid' ? 'good' : v.result.status === 'invalid' ? 'bad' : 'warn'}
          role="status"
          message={`${v.result.status === 'valid' ? '✓ ' : v.result.status === 'invalid' ? '✗ ' : ''}${v.result.message}`}
        >
          {v.keySource && <span className="muted">（{detailPreview(v.keySource)}）</span>}
        </Notice>
      )}
      {!v.keyText.trim() && (
        <p className="hint">
          {hmac
            ? '発行したサーバーと同じ秘密鍵を入力すると、署名が正しいかを確かめます。'
            : '発行者の公開鍵を入力すると、署名が正しいかを確かめます。ヘッダの kid と一致する鍵を JWK Set から選びます。'}
        </p>
      )}
    </section>
  );
}

function JsonPane({ title, text }: { title: string; text: string }) {
  return (
    <Pane title={title} actions={<CopyButton text={text} />}>
      {/** 長い JSON を丸ごと描画すると画面が止まるため、表示は先頭だけにする。コピーは全文を対象にする */}
      <TextOutputPreview label={title} text={text} as="pre" />
    </Pane>
  );
}
