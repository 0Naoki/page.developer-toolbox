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

/** 1つの入力（テキストかファイル、鍵）の、すべてのアルゴリズムのハッシュを求める */
export async function computeHashes(input: HashInput, { isCancelled, report }: AsyncContext<number>): Promise<HashResult> {
  /** 選んだ後にファイルが移動・削除されたときは、ブラウザの例外ではなく共通の文言で知らせる */
  const { useHmac, key } = input;
  const data = input.source === 'text' ? utf8(input.text) : await readFileWithin(input.file, MAX_FILE);
  if (isCancelled()) return CANCELLED;
  const keyBytes = useHmac ? hmacKeyBytes(key) : utf8('');
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
