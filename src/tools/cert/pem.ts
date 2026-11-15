import { containsPrivateKey, isPrivateKeyDer } from '../../lib/crypto/privateKey';
import { fileTooLargeMessage } from '../../lib/file';
import { detailPreview } from '../../lib/text/textPreview';
import { pemBodyToBytes, readPemBlocks } from '../../lib/crypto/pem';
import { formatNumber } from '../../lib/number';

/** 証明書・CSR の入力（PEM・DER・Base64 の本文）の読み取り。秘密鍵は解析せずに断る */

/** 受け付ける入力の大きさ（証明書のチェーンでも通常は数十KB） */
export const MAX_INPUT = 1024 * 1024;
/** 一度に解析・表示する証明書と CSR の合計上限。 */
export const MAX_PEM_BLOCKS = 64;

export type DerItem = { type: string; der: Uint8Array };

const PRIVATE_KEY_ERROR = '秘密鍵が含まれています。秘密鍵は貼り付けないでください（解析も保存もしていません）';

const SUPPORTED_PEM = ['CERTIFICATE', 'X509 CERTIFICATE', 'TRUSTED CERTIFICATE', 'CERTIFICATE REQUEST', 'NEW CERTIFICATE REQUEST'];

/**
 * PEM（-----BEGIN CERTIFICATE----- など）を読む。複数あればすべて。
 * BEGIN の行がなければ、全体を Base64 の DER として読む
 */
export function readPem(text: string): DerItem[] {
  if (containsPrivateKey(text)) throw new Error(PRIVATE_KEY_ERROR);
  if (text.length > MAX_INPUT) throw new Error(`入力が大きすぎます（${formatNumber(MAX_INPUT)}文字まで）`);
  const items = readPemBlocks(text, {
    checkType: (type) => {
      if (!SUPPORTED_PEM.includes(type)) {
        throw new Error(`「${detailPreview(type)}」には対応していません（証明書 CERTIFICATE と CSR CERTIFICATE REQUEST に対応しています）`);
      }
    },
    maxBlocks: MAX_PEM_BLOCKS,
    tooMany: `PEM は ${MAX_PEM_BLOCKS} ブロックまで読み込めます。入力を分割してください。`,
  });
  if (items.length > 0) return items;
  const der = pemBodyToBytes(text);
  if (isPrivateKeyDer(der)) throw new Error(PRIVATE_KEY_ERROR);
  return [{ type: 'BASE64', der }];
}

/** ファイルの中身を読む。DER（先頭が 0x30）ならそのまま、そうでなければ PEM として読む */
export function readFileBytes(bytes: Uint8Array): DerItem[] {
  if (bytes.length > MAX_INPUT) throw new Error(fileTooLargeMessage(MAX_INPUT));
  if (bytes[0] !== 0x30) return readPem(new TextDecoder().decode(bytes));
  if (isPrivateKeyDer(bytes)) throw new Error(PRIVATE_KEY_ERROR);
  return [{ type: 'DER', der: bytes }];
}
