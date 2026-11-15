import { useCallback, useState } from 'react';
import { useLatestRead } from './useLatestRead';
import { FileInputError, fileTooLargeMessage, readFileWithin } from '../lib/file';
import { errorMessage } from '../lib/errors';

export type FileLoaderOptions<T> = {
  /** 読み込むファイルの上限（バイト） */
  limit: number;
  /** 上限を超えたときの文言に足す案内（「。分割して読み込んでください。」など）。上限の文言は共通（fileTooLargeMessage） */
  tooLargeHint?: string;
  /** 新しいファイルを選んだ直後に呼ぶ（前のファイルの内容や入力を消すツールだけ） */
  onStart?: () => void;
  /** 読んだバイト列を、ツールが使う値にする。最新の読み込みのときだけ呼ぶ */
  decode: (bytes: Uint8Array<ArrayBuffer>, file: File) => T;
  /** decode が FileInputError 以外を投げたときの文言。省略時は例外の文言（errorMessage） */
  decodeErrorMessage?: (error: unknown) => string;
  /** 最新の読み込みが成功したときに呼ぶ */
  onLoaded: (value: T, file: File) => void;
};

/**
 * ファイルを選んで読み込み、最後に選んだファイルだけを反映する。
 *
 * @remarks
 * 上限の確認・読み込み・最新かどうかの確認・失敗の文言・読み込み中の表示をツール間でそろえる。
 * 新しいファイルを選んだとき、`cancel`・`clear` を呼んだとき（入力の編集・設定の変更など）、画面を離れたときに、
 * それより前の読み込みの結果を捨てる。読み込みの失敗（FileInputError）は共通の文言、
 * 読めた後の変換の失敗は `decodeErrorMessage` の文言で `error` に入れる。読み込んだ内容は保存しない。
 *
 * @typeParam T - decode が返す値の型。
 * @returns `pick`（選んだファイルを読み込む）、`cancel`（進行中の読み込みを捨てる。文言は残す）、
 *   `clear`（読み込みを捨て、文言も消す）、`loading`（読み込み中）、`error`（表示する文言。なければ空文字）。
 *   `cancel`・`clear` は描画のたびに変わらない。
 */
export function useFileLoader<T>(options: FileLoaderOptions<T>) {
  const read = useLatestRead();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  /** effect の依存に入れられるよう、描画のたびに作り直さない */
  const cancel = useCallback(() => {
    read.cancel();
    setLoading(false);
  }, [read]);
  const clear = useCallback(() => {
    cancel();
    setError('');
  }, [cancel]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    const { limit, tooLargeHint = '', onStart, decode, decodeErrorMessage = errorMessage, onLoaded } = options;
    const isCurrent = read.start();
    onStart?.();
    setError('');
    if (file.size > limit) {
      setLoading(false);
      setError(fileTooLargeMessage(limit) + tooLargeHint);
      return;
    }
    setLoading(true);
    try {
      const bytes = await readFileWithin(file, limit);
      if (!isCurrent()) return;
      let value: T;
      try {
        value = decode(bytes, file);
      } catch (e) {
        setError(e instanceof FileInputError ? e.message : decodeErrorMessage(e));
        return;
      }
      onLoaded(value, file);
    } catch (e) {
      if (isCurrent()) setError(errorMessage(e));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };

  return { pick, cancel, clear, loading, error };
}
