/** 埋め込み・openerを検出した場合は入力欄を出さず、独立したタブへ案内する。 */
export function LaunchNotice({ reason }: { reason: 'frame' | 'opener' }) {
  const framed = reason === 'frame';
  const url = location.href;
  return (
    <main className="main">
      <section className="tool-header">
        <h1>{framed ? '別のタブで開いてください' : '新しいタブで開き直してください'}</h1>
        <p>{framed
          ? '安全のため、Dev Toolbox はほかのページの中では使えません。'
          : '別のページから開かれたため、開いた元のページとの関係を解除しました。'}</p>
        {!framed && <p>このタブにはデータを入力せず、次のリンクから開き直してください。開いた先のアドレスも確認してください。</p>}
        <p>
          <a href={url} target="_blank" rel="noopener noreferrer">
            {framed ? url : 'Dev Toolbox を新しいタブで開く'}
          </a>
        </p>
        {!framed && <p>次回からは、確認済みのアドレスをブックマークするか、アドレスバーに直接入力して開いてください。</p>}
      </section>
    </main>
  );
}
