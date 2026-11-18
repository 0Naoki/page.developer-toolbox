/** 長さと異なる文字数を分け、重複除去の費用と大きな文字集合の費用を測る合成入力。 */
export function passwordInputs() {
  return [
    ...[1000, 100_000, 1_000_000].map((codePoints) => ({ alphabet: 'repeated', codePoints, distinctSymbols: 1, symbols: 'x'.repeat(codePoints) })),
    ...[1000, 100_000].map((codePoints) => ({ alphabet: 'distinct', codePoints, distinctSymbols: codePoints,
      symbols: Array.from({ length: codePoints }, (_, i) => String.fromCodePoint(0x10000 + i)).join('') })),
  ];
}
