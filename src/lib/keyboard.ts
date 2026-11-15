/** キーの判定に使う値（ブラウザの KeyboardEvent） */
type KeyState = Pick<KeyboardEvent, 'isComposing' | 'keyCode'>;

/**
 * 日本語入力（IME）の変換中のキーか。変換中の Enter・矢印キー・Escape は、変換の確定や候補選びに使われるので、
 * 画面の操作（追加・移動・閉じる）に使わない。
 *
 * @remarks
 * Safari は変換を確定する Enter を、変換の終了（isComposing が false）の後に送るため、keyCode 229 でも判定する。
 *
 * @param event - ブラウザの KeyboardEvent、または React の KeyboardEvent（nativeEvent を見る）。
 */
export function isImeComposing(event: KeyState | { nativeEvent: KeyState }): boolean {
  const native = 'nativeEvent' in event ? event.nativeEvent : event;
  return native.isComposing || native.keyCode === 229;
}
