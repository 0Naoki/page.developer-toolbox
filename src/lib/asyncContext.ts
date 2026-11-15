/**
 * 非同期の計算（署名の検証・ハッシュなど）に渡す、取り消しの確認と途中経過の報告。
 *
 * @remarks
 * 画面では `src/hooks/useAsyncFor.ts` が作って渡す。React に依存させずに計算処理（`src/tools/hash/computeHashes.ts` など）から
 * 使えるよう、型だけをここに置く。
 *
 * @typeParam P - 途中経過（進捗など）の型。
 */
export type AsyncContext<P> = {
  /** key が変わった・画面を離れたなら true。長い計算は区切りごとに確かめて打ち切る */
  isCancelled: () => boolean;
  /** 途中経過（進捗など）を、今の key の結果として画面に渡す。取り消した後は何もしない */
  report: (progress: P) => void;
};
