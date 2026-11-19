/**
 * 「サンプル」のボタンで入れるトークンと、検証に使う秘密鍵（テスト専用の架空の値。tokens.fixtures.ts の TOKENS.HS256・SECRET と同じ）。
 *
 * @remarks
 * HS256 で署名し、有効期限は 2100 年（exp: 4102444800）。秘密鍵は公開してよいテスト用の値で、実在のサービスでは使われていない。
 * テストのデータは画面から読み込まない決まりのため、値を写して、同じであることを verify.test.ts で確かめる。
 */
export const SAMPLE_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IuODhuOCueODiCIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwfQ.7WgFgrwyH8QnHmyyy3dJJCmW6SPQL2GWVxKfaGjr0Jk";
/** SAMPLE_TOKEN の署名に使った秘密鍵（UTF-8 のテキスト） */
export const SAMPLE_SECRET = "dev-toolbox-test-secret-0123456789";
