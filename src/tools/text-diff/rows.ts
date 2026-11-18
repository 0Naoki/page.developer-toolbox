import type { DiffLine, DiffRow } from './logic';

/** 左右表示の行と、未展開の範囲。from は圧縮前の差分の行位置。 */
export type FoldedRow = DiffRow | { kind: 'fold'; count: number; from: number };

/** 統合表示の行。コピー用のパッチとは区別し、左右の行番号を持つ。 */
export type UnifiedDisplayRow =
  | { kind: 'fold'; count: number; from: number }
  | { kind: 'equal' | 'del' | 'add'; line: DiffLine; aNo?: number; bNo?: number };
