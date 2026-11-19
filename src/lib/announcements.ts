import { formatNumber } from './number';

/**
 * 読み上げを待っている文言（src/components/LiveAnnouncer.tsx が使う）。
 *
 * @remarks
 * 文言は、出した側（エラー表示の1つ1つ）ごとに最新の1つだけを持つ。読み上げる前に文言が消えた・変わった・画面を離れたときは、
 * その側の文言だけを取り消すため、入力の途中で一瞬だけ出て直ったエラーや、もう表示していないエラーは読まない。
 * 時間の管理（待ってから読む）は呼び出す側が行う。
 */
export class PendingAnnouncements {
  private readonly bySource = new Map<symbol, string>();

  /** source の文言を、読み上げを待つ最新の文言にする（前の文言は読まない） */
  set(source: symbol, text: string): void {
    /** 入れ直した文言を後ろに並べる（Map は最初に入れた順を保つため） */
    this.bySource.delete(source);
    this.bySource.set(source, text);
  }

  /** source の、まだ読んでいない文言を取り消す */
  cancel(source: symbol): void {
    this.bySource.delete(source);
  }

  /** 読み上げる文言を出した順に取り出し、空にする。同じ文言は1つにまとめる */
  take(): string[] {
    const texts = [...new Set(this.bySource.values())];
    this.bySource.clear();
    return texts;
  }
}

/** 入力が止まってから読み上げるまでの時間（ミリ秒） */
export const ANNOUNCE_DELAY_MS = 800;
/** 読み上げの領域をいったん空にしてから、文言を入れるまでの時間（ミリ秒） */
export const PUBLISH_DELAY_MS = 50;
/** 1回に読み上げる文言の数 */
const MAX_ITEMS = 3;

/**
 * 読み上げの時間の管理。最後の文言から {@link ANNOUNCE_DELAY_MS} 待ち、その間に出て、まだ表示している文言をまとめて
 * 読み上げの領域に入れる（同じ文言は1回、最大 {@link MAX_ITEMS} 件）。
 *
 * @param show - 読み上げの領域の文言を書き換える関数。
 */
export class Announcer {
  private readonly pending = new PendingAnnouncements();
  /** 入力が止まるのを待つタイマー。新しい文言が出るたびに数え直す */
  private waitTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * 取り出した文言を領域に入れるタイマー。新しい文言が出ても取り消さない
   * （待つタイマーと共用すると、待ち行列から取り出した後の文言が、領域に入る前に失われる）
   */
  private publishTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly show: (text: string) => void;

  constructor(show: (text: string) => void) {
    this.show = show;
  }

  /** source の文言を読み上げを待つ文言にし、待ち時間を最初から数え直す */
  announce(source: symbol, text: string): void {
    this.pending.set(source, text);
    clearTimeout(this.waitTimer);
    this.waitTimer = setTimeout(() => this.flush(), ANNOUNCE_DELAY_MS);
  }

  /** source の、まだ読んでいない文言を取り消す */
  cancel(source: symbol): void {
    this.pending.cancel(source);
  }

  private flush(): void {
    const items = this.pending.take();
    /** 待つ間に、どの文言も消えた（エラーを直した）ときは読まない */
    if (items.length === 0) return;
    const rest = items.length - MAX_ITEMS;
    const text = items.slice(0, MAX_ITEMS).join('。') + (rest > 0 ? `。ほか ${formatNumber(rest)} 件` : '');
    /** 前と同じ文言でも読み直すよう、いったん空にしてから入れる */
    this.show('');
    /** 次の読み上げは最後の文言から ANNOUNCE_DELAY_MS 後で、この予約より後になるため、通常は重ならない（念のため前の予約は消す） */
    clearTimeout(this.publishTimer);
    this.publishTimer = setTimeout(() => this.show(text), PUBLISH_DELAY_MS);
  }
}
