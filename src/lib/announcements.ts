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
