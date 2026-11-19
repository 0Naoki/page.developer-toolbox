/** 診断TSVの組み立て。行ごとの文字列を最後まで保持せず、一定量で連結する。 */
export class ReportText {
  private chunks: string[] = [];
  private pending: string[] = [];
  private pendingLength = 0;
  private size = 0;
  private limit: number;
  constructor(limit: number) { this.limit = limit; }
  get length(): number { return this.size; }
  /** 集約中の出力下限と、実際の出力長の両方で使う。 */
  check(length: number): void {
    if (length > this.limit) throw new Error('診断の全件出力が大きすぎます。入力を分割してください。');
  }
  row(cells: (string | number)[]): void {
    const text = (this.size ? '\n' : '') + cells.join('\t');
    this.check(this.size + text.length);
    this.size += text.length;
    this.pending.push(text);
    this.pendingLength += text.length;
    if (this.pendingLength >= 16_384) this.flush();
  }
  private flush(): void {
    if (!this.pending.length) return;
    this.chunks.push(this.pending.join(''));
    this.pending = [];
    this.pendingLength = 0;
  }
  finish(): string {
    this.flush();
    return this.chunks.join('');
  }
}
