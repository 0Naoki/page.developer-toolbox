/**
 * 読み上げソフトへの知らせ（エラーと、バッジなどで示す判定の結果）。アプリに1つだけ置く live region（{@link LiveRegion}）で読み上げる。
 *
 * @remarks
 * 表示を切り替えるたびに role="status" の要素を差し込むと、読み上げソフトによっては読まない（差し込む前からある領域の変化だけを読む）。
 * そこで、常にある1つの領域の文言を書き換える。入力のたびに読むと騒がしいため、最後の変化から少し待ち、
 * その間に出て、まだ表示している文言をまとめて読む（待ち時間と件数は {@link Announcer}）。文言は抜粋（detailPreview）にする。
 * 文言は画面にも表示している内容だけで、保存も送信もしない。
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Announcer } from '../lib/announcements';
import { detailPreview } from '../lib/text/textPreview';

let current = '';
const listeners = new Set<() => void>();

const announcer = new Announcer((text) => {
  current = text;
  listeners.forEach((listener) => listener());
});

/**
 * 文言が表示された・変わったときに読み上げる（同じ文言のままの再描画では読まない）。
 * 読み上げる前に文言が消えた・変わった・画面を離れたときは、この呼び出しの文言だけを取り消す。
 *
 * @param message - 読み上げる文言。null・undefined・空文字なら何もしない。
 */
export function useAnnounce(message: string | null | undefined): void {
  const [source] = useState(() => Symbol('announce'));
  useEffect(() => {
    const text = message ? detailPreview(message.trim()) : '';
    if (text === '') return;
    announcer.announce(source, text);
    return () => announcer.cancel(source);
  }, [source, message]);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * 読み上げ用の領域（画面には表示しない）。App に1つだけ置く。
 * role は付けない（各画面の status の要素、たとえば計算の状態と区別できるように。読み上げは aria-live だけで行われる）
 */
export function LiveRegion() {
  const text = useSyncExternalStore(subscribe, () => current, () => '');
  return (
    <div className="visually-hidden" aria-live="polite" aria-atomic="true" data-live-region="">
      {text}
    </div>
  );
}
