import { Component, type ReactNode } from 'react';
import { ErrorBox } from './ErrorMessage';

type Props = { children: ReactNode };
type State = { error: Error | null };

/** 画面の読み込み失敗（新しい版の公開で古いファイルが消えた場合など）か */
const isChunkLoadError = (e: Error) =>
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(
    e.message,
  );

/**
 * ツール画面で起きた例外を受け止め、アプリ全体が消えないようにする。
 * React はクラスコンポーネントでしか描画中の例外を受け止められない。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <section className="tool-header">
        <h1>画面を表示できません</h1>
        <ErrorBox
          title={isChunkLoadError(error)
            ? '新しい版が公開されたため、この画面を読み込めませんでした。'
            : '予期しないエラーが発生しました。'}
          message={error.message}
          code
        />
        <p>
          <button type="button" className="btn btn-primary" onClick={() => location.reload()}>
            再読み込み
          </button>
        </p>
      </section>
    );
  }
}
