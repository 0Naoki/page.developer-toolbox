import type { AsyncContext } from '../../lib/asyncContext';
import { bytesToBase64, toHex } from '../../lib/bytes';
import { readFileWithin } from '../../lib/file';
import { ALGORITHMS, MAX_FILE, digest, hmac, hmacKeyBytes, md5Chunked, utf8, type Algorithm } from './logic';

export type Row = { algorithm: Algorithm; hex: string; base64: string };
export type HashInput = ({ source: 'text'; text: string } | { source: 'file'; file: File }) & { useHmac: boolean; key: string };
export type HashResult = { rows: Row[]; error: string };

/** これより大きいデータは MD5 の進捗を表示する */
const PROGRESS_THRESHOLD = 8 * 1024 * 1024;

/** 取り消した計算の結果。useAsyncFor が捨てるため、画面には出ない */
const CANCELLED: HashResult = { rows: [], error: '' };

/** 再利用するファイルの上限。最大256 MiBの入力全体を、計算後も保持し続けないため。 */
export const MAX_CACHED_FILE_BYTES = 8 * 1024 * 1024;

/**
 * 画面の寿命に限った計算器。同じFileの小さい読込だけを共有し、鍵やハッシュ結果は記録しない。
 * @remarks 読込中のPromiseも共有する。ファイル・入力元の変更と画面移動ではclearで破棄する。保存領域は使わない。
 */
export function createHashComputer() {
  let cached: { file: File; read: Promise<Uint8Array<ArrayBuffer>> } | null = null;
  const clear = () => { cached = null; };
  const read = (file: File) => {
    if (cached?.file === file) return cached.read;
    clear();
    const pending = readFileWithin(file, MAX_FILE);
    if (file.size <= MAX_CACHED_FILE_BYTES) {
      cached = { file, read: pending };
      void pending.catch(() => { if (cached?.read === pending) clear(); });
    }
    return pending;
  };
  return {
    clear,
    run: (input: HashInput, context: AsyncContext<number>) => computeHashes(input, context, read),
  };
}

/** 1つの入力（テキストかファイル、鍵）の、すべてのアルゴリズムのハッシュを求める */
export async function computeHashes(input: HashInput, { isCancelled, report }: AsyncContext<number>, readFile = (file: File) => readFileWithin(file, MAX_FILE)): Promise<HashResult> {
  const { useHmac, key } = input;
  /** 鍵だけで拒否できる入力では、ファイルの読み込みやテキストの符号化を始めない。 */
  const keyBytes = useHmac ? hmacKeyBytes(key) : utf8('');
  /** 選んだ後にファイルが移動・削除されたときは、ブラウザの例外ではなく共通の文言で知らせる */
  const data = input.source === 'text' ? utf8(input.text) : await readFile(input.file);
  if (isCancelled()) return CANCELLED;
  const rows: Row[] = [];
  /** SHA 系は Web Crypto API（非同期・別スレッド）で計算する */
  for (const algorithm of ALGORITHMS) {
    if (algorithm === 'MD5') continue;
    const bytes = useHmac ? await hmac(algorithm, keyBytes, data) : await digest(algorithm, data);
    if (isCancelled()) return CANCELLED;
    rows.push({ algorithm, hex: toHex(bytes), base64: bytesToBase64(bytes) });
  }
  /** MD5 は自前実装なので、4 MiB ずつ処理して画面を止めない */
  if (!useHmac) {
    const bytes = await md5Chunked(data, data.length > PROGRESS_THRESHOLD ? report : undefined, isCancelled);
    if (!bytes) return CANCELLED;
    rows.unshift({ algorithm: 'MD5', hex: toHex(bytes), base64: bytesToBase64(bytes) });
  }
  return { rows, error: '' };
}
