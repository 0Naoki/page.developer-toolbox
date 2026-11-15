import { bytesToBase64 } from '../../lib/bytes';
import { judgeJwt, parseJwt, type DecodedJwt } from './logic';

/**
 * テスト用の、実際に署名したトークンと公開鍵（公開してよいデータだけ）。
 * Node.js の crypto で署名し、署名に使った秘密鍵は保存していない。
 * ES256 は証明書デコーダーのテスト用のサーバー証明書（LEAF）の鍵、EdDSA は ED25519 の証明書の鍵で署名している。
 * ペイロードはすべて \{"sub":"1234567890","name":"テスト","iat":1700000000,"exp":4102444800\}
 */

/** HS256・HS512 の秘密鍵（テスト専用の値） */
export const SECRET = "dev-toolbox-test-secret-0123456789";
/** Base64 で入力する秘密鍵（UTF-8 の「0123456789abcdef0123456789abcdef」） */
export const SECRET_BASE64 = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

export const TOKENS = {
  HS256: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IuODhuOCueODiCIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwfQ.7WgFgrwyH8QnHmyyy3dJJCmW6SPQL2GWVxKfaGjr0Jk",
  HS512: "eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IuODhuOCueODiCIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwfQ.BioRtOSU-2IU90BFu-Nnp8tpaC67K_3EjMKFCyPeN5eZps7FDtUIKtGte2R_YR3HvAccDwGkEcYRaYBY-0ESPA",
  /** 秘密鍵「secret」（短すぎる）で署名 */
  HS256_SHORT: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IuODhuOCueODiCIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwfQ.0FQ-AOJbnKTs2Q99aXO4U0JnTX2Hnew2gbfR3OdZgS0",
  /** SECRET_BASE64 をデコードしたバイト列で署名 */
  HS256_B64: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IuODhuOCueODiCIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwfQ.H1JmyxEzpViDpYg3_y1uik_JV6bmar7cfFXr0m0VPiw",
  /** ヘッダに kid: rsa-1 */
  RS256: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InJzYS0xIn0.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IuODhuOCueODiCIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwfQ.lmWhDkYqcp8TeDOGTAfal-PH7Azie8SWMwFqCHNC9a7hB3rQhj3lvyvF1W5up5Mcpm5oQc_-PEIJvxA5rVSzUad3YhMMkbh1PnSS4uBsOUKiMXjgKVzmQxribCYvsLQeRKYD0mK4fZx7bFbRLPjCUduws-r0IIxClzxma-3LyDKYpn9mHpscfqu-dLe2hYsrTNkgAC5A45dyqyNEn-gno8ABNwm9jeXiEn9ZUpoJrNZoSAVbNEDsYLntLyIO57RrriUwpFjctyZ1fdLYPteNBoCSHepvSVOwKKd98d02xguJoZZ75APRvoQfIRgbt_5afsV6U4TBPQOYnnknhEqeeQ",
  /** ヘッダに kid: rsa-1。ソルト長はハッシュと同じ32バイト */
  PS256: "eyJhbGciOiJQUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InJzYS0xIn0.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IuODhuOCueODiCIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwfQ.nY8nxKQvbaiBLHAJTuyPWHVQqvnxQPSKlpN4feOeyG9jV1PCdcuxTAkSleNpYKGhXQwat2fvDMd8M2w1w33ErgAr6v8S_q-ZqREjyLlY103uI-X5rFqvcvBCYsceqE9v8djXeb1g4Z_60dO8Ot7P8ZmbDfljSsTET2BNz04l4BvyS8Y6vaBZiS3E3q8p81i3y5lVtDeV-Jzu5vh1gB7Yo6KzeAfEIfEKeGSntifVhlBk6shJ6YjOxXT4P1RdAgPh86rY0O07dsvYABppkxfNVhvG-MuJ7TroC23oG9LqqTO4nGscvW1bH-ECvBNx4-EvsFENMh3xRtGLLWc-cHPM5g",
  ES256: "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IuODhuOCueODiCIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwfQ.vu2MTLUAqjJhOLK9N6JM2hqPVBqFEFJqZS338xc1r4VrzL8fzs5lmstMaf5pwveN3pjZ74pkXI3aOK_fqAALyg",
  /** 署名を誤って DER 形式にしたもの（JWS では r と s を並べた64バイト） */
  ES256_DER: "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IuODhuOCueODiCIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwfQ.MEYCIQDe5lJQ6fr4B8zi7aSLeIkM50C1sU56obSnD0x-133gSAIhAJ6OP45ClrE8R3IIthSFtMcyNSr3jp5vb8Pg6hLaJ3jh",
  /** ヘッダに kid: ec-384 */
  ES384: "eyJhbGciOiJFUzM4NCIsInR5cCI6IkpXVCIsImtpZCI6ImVjLTM4NCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IuODhuOCueODiCIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwfQ.issftdTwbKFE_uJ10Ji2tSU2IyeD3DxK3FvirV9nWcEIEWGwI7sA5g45iiZP91Q96yZfnZ8zR5_hQRXeW8jb3uy7K62gweDXYOzHsYLMvt8j8LLoL7VVn-1N2n-emX4q",
  ES512: "eyJhbGciOiJFUzUxMiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IuODhuOCueODiCIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwfQ.ANxkT5_V_t-n8Eev-y6tIeA23qwwAFXfSrM9rNdY3IPBfxMpMuLimHCl5-SbSOpiRJA8VoDiCjIS6P-nGhjh6F2TAHX0OpY_PEK2dtPtZuxhC_DL1ksK0vmlGC-RsX2Nr7ysb9kuldIkvFJV-aDtPg_3F0_yVhUpTA_-OPyu6RNyK87p",
  EDDSA: "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IuODhuOCueODiCIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwfQ.5AkuzpeP1nXw46sYsYFtcZGcCCFToDZVmfd8CnlImEOUAfpT_Z1gBQXejPUEgTXsr-cZ3Qi5njd4CHzUoIk_CA",
} as const;

/** RS256・PS256 の公開鍵（SubjectPublicKeyInfo） */
export const RSA_PUBLIC_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqxi5Y3EUKUF2pkW56iyE
eiQ/DF7ZEPWkuj1v8PLh1QY+eaMutxTS09e5nCjZTWv0GKmIVm/P1PoKw1WW+TWi
zGRj18d88MoSDYxO7vV3vd6R+scsEHH/8//TaKHeZPL+kAv1zqGu4Mu3xsMPlqLM
zXaZE0CmXOInYoPJv+nbpROeXXo/fu2rfCxsnlqb/2WJ/jSWY/A0nnWot5jrsvHc
Ba+VVHGKsqbkv9slCpoEffbT7hCov3G14o/j/k38gvKB8A9k96n8UqA2LNr0oF+y
sNazg0hDCSIahwehmLB10/HGORy7O3kLPd+Lx5fq+BgDLv79D85iZK+hVa9hVrR1
7QIDAQAB
-----END PUBLIC KEY-----`;

/** 同じ公開鍵の PKCS#1 形式（BEGIN RSA PUBLIC KEY） */
export const RSA_PUBLIC_PKCS1_PEM = `-----BEGIN RSA PUBLIC KEY-----
MIIBCgKCAQEAqxi5Y3EUKUF2pkW56iyEeiQ/DF7ZEPWkuj1v8PLh1QY+eaMutxTS
09e5nCjZTWv0GKmIVm/P1PoKw1WW+TWizGRj18d88MoSDYxO7vV3vd6R+scsEHH/
8//TaKHeZPL+kAv1zqGu4Mu3xsMPlqLMzXaZE0CmXOInYoPJv+nbpROeXXo/fu2r
fCxsnlqb/2WJ/jSWY/A0nnWot5jrsvHcBa+VVHGKsqbkv9slCpoEffbT7hCov3G1
4o/j/k38gvKB8A9k96n8UqA2LNr0oF+ysNazg0hDCSIahwehmLB10/HGORy7O3kL
Pd+Lx5fq+BgDLv79D85iZK+hVa9hVrR17QIDAQAB
-----END RSA PUBLIC KEY-----`;

/** ES512 の公開鍵 */
export const P521_PUBLIC_PEM = `-----BEGIN PUBLIC KEY-----
MIGbMBAGByqGSM49AgEGBSuBBAAjA4GGAAQAsR9k4HtFDAnKFKi0KfwkT5iAhcLz
R27u+VHHab/FazoARQZ+3RtcM5Fyedz9F6PiqBE8rZ1CtV0N1PmHPfCVZnUAllHw
0xEQOi3616tmSmdaF6BBe3/vGsVMMwnX3Hjol8ZSwrv7s7nKczT8a39Kjg8ro4XX
zEBgu7GY80gE1JfHjAs=
-----END PUBLIC KEY-----`;

/** RS256・PS256 の公開鍵（JWK） */
export const RSA_JWK = {"kty":"RSA","n":"qxi5Y3EUKUF2pkW56iyEeiQ_DF7ZEPWkuj1v8PLh1QY-eaMutxTS09e5nCjZTWv0GKmIVm_P1PoKw1WW-TWizGRj18d88MoSDYxO7vV3vd6R-scsEHH_8__TaKHeZPL-kAv1zqGu4Mu3xsMPlqLMzXaZE0CmXOInYoPJv-nbpROeXXo_fu2rfCxsnlqb_2WJ_jSWY_A0nnWot5jrsvHcBa-VVHGKsqbkv9slCpoEffbT7hCov3G14o_j_k38gvKB8A9k96n8UqA2LNr0oF-ysNazg0hDCSIahwehmLB10_HGORy7O3kLPd-Lx5fq-BgDLv79D85iZK-hVa9hVrR17Q","e":"AQAB","kid":"rsa-1","alg":"RS256","use":"sig"};
/** ES384 の公開鍵（JWK） */
export const P384_JWK = {"kty":"EC","x":"MLRLoy2LKyl9WCvHYruN78y9M-moYm2VkM71t9zBC0mb3vM-g4QztqO4QdEzdXGg","y":"rUtRHwuLTPB3w4EKk7BqwZ2pj5hozQAGJFtsJ-2H3Or_KP8VQgfXzyXzo5WkDlhG","crv":"P-384","kid":"ec-384"};
/** ES256 の公開鍵（JWK）。証明書の LEAF と同じ鍵 */
export const LEAF_JWK = {"kty":"EC","x":"wNVPDdvcuvGT7iPa-wLWTYJ2ExEP3G4OiXcqtly_gMA","y":"Mo4Bx3MUjBzx7Jo0NoNHYD0D-VEEMkyXGejb8Z-PHko","crv":"P-256"};

/**
 * テストでトークンを組み立てるための、パディングなしの Base64URL。
 * 文字列は UTF-8 にして変換する。UTF-8 として不正な値を作るときは、バイト列で渡す。
 * 長い値でも引数の展開で RangeError にならないよう、アプリと同じ変換（{@link bytesToBase64}）を使う
 */
export const base64Url = (value: string | Uint8Array): string =>
  bytesToBase64(typeof value === 'string' ? new TextEncoder().encode(value) : value, { urlSafe: true });

/**
 * テストの補助：トークンを読み、指定した時刻での判定まで行う（画面と同じく {@link parseJwt} と {@link judgeJwt} を順に呼ぶ）。
 *
 * @param now - 時刻判定の基準となるミリ秒単位の UNIX 時刻。省略時は現在時刻。
 */
export const decodeJwt = (token: string, now: number = Date.now()): DecodedJwt => judgeJwt(parseJwt(token), now);
