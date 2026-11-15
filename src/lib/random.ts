/** 乱数で埋める配列（crypto.getRandomValues が受け付ける型のうち、ツールで使うもの） */
export type RandomArray = Uint8Array<ArrayBuffer> | Uint32Array<ArrayBuffer>;

/** 配列を乱数で埋める関数。テストで決まった値に差し替えられるよう、ツールの処理は引数で受け取る */
export type Rng<T extends RandomArray> = (array: T) => void;

/** 暗号論的乱数（crypto.getRandomValues）で埋める。Math.random は使わない */
export const cryptoRng = <T extends RandomArray>(array: T): void => {
  crypto.getRandomValues(array);
};
