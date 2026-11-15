/** Web Crypto API に渡すことができる曲線名。検証で使うかどうかは各ツールが判断する。 */
export type WebCryptoCurve = 'P-256' | 'P-384' | 'P-521';

export type CurveInfo =
  | { readonly name: WebCryptoCurve; readonly bits: number; readonly webCrypto: true }
  | { readonly name: 'secp256k1'; readonly bits: number; readonly webCrypto: false };

/** 曲線のOID・名称・ビット数を1か所に持つ。表示用の曲線も残し、検証に使える曲線と区別する。 */
const CURVES: Readonly<Record<string, CurveInfo>> = {
  '1.2.840.10045.3.1.7': { name: 'P-256', bits: 256, webCrypto: true },
  '1.3.132.0.34': { name: 'P-384', bits: 384, webCrypto: true },
  '1.3.132.0.35': { name: 'P-521', bits: 521, webCrypto: true },
  '1.3.132.0.10': { name: 'secp256k1', bits: 256, webCrypto: false },
};

/** 対応表にない曲線は undefined。未知のOIDや、曲線を直接指定した鍵の扱いは呼び出し側に残す。 */
export const curveInfo = (oid: string): CurveInfo | undefined => Object.hasOwn(CURVES, oid) ? CURVES[oid] : undefined;
