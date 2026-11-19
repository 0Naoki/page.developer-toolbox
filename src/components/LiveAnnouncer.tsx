import { useEffect, useSyncExternalStore } from 'react';
import { detailPreview } from '../lib/text/textPreview';
import { formatNumber } from '../lib/number';

/**
 * 読み上げソフトへの知らせ（エラーと、バッジなどで示す判定の結果）。アプリに1つだけ置く live region（{@link LiveRegion}）で読み上げる。
 *
 * @remarks
 * 表示を切り替えるたびに role="status" の要素を差し込むと、読み上げソフトによっては読まない（差し込む前からある領域の変化だけを読む）。
 * そこで、常にある1つの領域の文言を書き換える。入力のたびに読むと騒がしいため、最後の変化から {@link DELAY_MS} 待ち、
 * その間に出た文言をまとめて読む（同じ文言は1回、最大 {@link MAX_ITEMS} 件）。文言は抜粋（detailPreview）にする。
 * 文言は画面にも表示している内容だけで、保存も送信もしない。
 */

/** 入力が止まってから読み上げるまでの時間（ミリ秒） */
const DELAY_MS = 800;
/** 1回に読み上げる文言の数 */
const MAX_ITEMS = 3;

let pending: string[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let current = '';
const listeners = new Set<() => void>();

const setCurrent = (text: string) => {
  current = text;
  listeners.forEach((listener) => listener());
};

function flush(): void {
  const items = pending;
  pending = [];
  const rest = items.length - MAX_ITEMS;
  const text = items.slice(0, MAX_ITEMS).join('。') + (rest > 0 ? `。ほか ${formatNumber(rest)} 件` : '');
  /** 前と同じ文言でも読み直すよう、いったん空にしてから入れる */
  setCurrent('');
  timer = setTimeout(() => setCurrent(text), 50);
}

/** 文言を読み上げの待ち行列に入れる。空の文言は無視する */
function announce(message: string): void {
  const text = detailPreview(message.trim());
  if (text === '') return;
  if (!pending.includes(text)) pending.push(text);
  clearTimeout(timer);
  timer = setTimeout(flush, DELAY_MS);
}

/**
 * 文言が表示された・変わったときに読み上げる（同じ文言のままの再描画では読まない）。
 *
 * @param message - 読み上げる文言。null・undefined・空文字なら何もしない。
 */
export function useAnnounce(message: string | null | undefined): void {
  useEffect(() => {
    if (message) announce(message);
  }, [message]);
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
