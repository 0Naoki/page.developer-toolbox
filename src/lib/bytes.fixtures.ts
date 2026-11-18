/** Base64変換・PEM・HMAC鍵で共通に保持する、パディングの有効な入力と復号結果。 */
export const VALID_BASE64_PADDING = [
  ['YQ', 'a'], ['YQ==', 'a'], ['YWI', 'ab'], ['YWI=', 'ab'], ['YWJj', 'abc'], [' Y Q = =\r\n', 'a'],
] as const;

/** 余剰・部分的な省略・本文なし・途中挿入・本文の長さ不正を黙って補正しない。 */
export const INVALID_BASE64_PADDING = ['YWJj=', 'YWJj==', 'YQ=', 'YQ===', 'YWI==', '=', '===', '====', 'YQ=a', 'A==', 'A'] as const;
