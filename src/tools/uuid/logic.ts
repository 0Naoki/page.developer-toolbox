import { toHex } from '../../lib/bytes';
import { cryptoRng, type Rng as RandomFill } from '../../lib/random';

/** 乱数源。テストで差し替えられるように引数で受け取る */
export type Rng = RandomFill<Uint8Array<ArrayBuffer>>;

const randomBytes = (n: number, rng: Rng) => {
  const b = new Uint8Array(n);
  rng(b);
  return b;
};

function formatUuid(bytes: Uint8Array): string {
  const h = toHex(bytes);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** UUID v4（完全ランダム） */
export function uuidV4(rng: Rng = cryptoRng): string {
  const b = randomBytes(16, rng);
  /** b は 16 バイト（?? 0 は型のためだけ） */
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  return formatUuid(b);
}

const RAND_MAX_74 = (1n << 74n) - 1n;

/**
 * UUID v7 の生成器（RFC 9562）。先頭48ビットがミリ秒のUNIX時間なので、DBの主キーにしても挿入位置が散らばらない。
 *
 * 時刻が同じ（または時計が戻った）ときは、残り74ビットの乱数部を +1 して必ず生成順に並ぶようにする
 * （RFC 9562 6.2 の「乱数部をカウンタとして増やす」方式）。桁あふれしたら時刻を1ミリ秒進める。
 */
export function createUuidV7Generator(rng: Rng = cryptoRng) {
  let lastTime = -1;
  let rand = 0n;
  const fresh = () => {
    let v = 0n;
    for (const x of randomBytes(10, rng)) v = (v << 8n) | BigInt(x);
    return v >> 6n; /** 80ビット → 74ビット */
  };
  return (now: number = Date.now()): string => {
    if (now > lastTime) {
      lastTime = now;
      rand = fresh();
    } else if (rand < RAND_MAX_74) {
      rand += 1n;
    } else {
      lastTime += 1;
      rand = fresh();
    }
    const b = new Uint8Array(16);
    let t = lastTime;
    for (let i = 5; i >= 0; i--) {
      b[i] = t % 256;
      t = Math.floor(t / 256);
    }
    const randA = Number(rand >> 62n); /** 上位12ビット */
    let randB = rand & ((1n << 62n) - 1n); /** 下位62ビット */
    b[6] = 0x70 | (randA >> 8);
    b[7] = randA & 0xff;
    for (let i = 15; i >= 8; i--) {
      b[i] = Number(randB & 0xffn);
      randB >>= 8n;
    }
    b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
    return formatUuid(b);
  };
}

/** ULID */

/** Crockford の Base32（I, L, O, U を含まない） */
const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const MAX_TIME = 2 ** 48 - 1;

export function encodeUlidTime(time: number): string {
  if (!Number.isInteger(time) || time < 0 || time > MAX_TIME) throw new Error('ULIDの時刻が範囲外です');
  let out = '';
  let t = time;
  for (let i = 0; i < 10; i++) {
    out = ULID_ALPHABET[t % 32] + out;
    t = Math.floor(t / 32);
  }
  return out;
}

/** 80ビットの乱数部を16文字に変換する */
function encodeUlidRandom(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ULID_ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  return out;
}

/**
 * 画面で使う、生成順に並ぶ形式（v7・ULID）の生成器の組。
 *
 * @remarks
 * 生成器は直前の時刻と乱数部を覚えて、同じミリ秒や時計が戻ったときも生成順に並べる。
 * 「生成」のたびに作り直すと、この記憶が引き継がれず、後の生成が前より小さくなり得るため、画面を開いている間は同じ組を使う。
 */
export function createSortableIdGenerators(rng: Rng = cryptoRng) {
  return { v7: createUuidV7Generator(rng), ulid: createUlidGenerator(rng) };
}

/**
 * 単調増加する ULID 生成器。
 * 同じミリ秒内に複数生成しても、乱数部を +1 することで生成順にソートされることを保証する。
 */
export function createUlidGenerator(rng: Rng = cryptoRng) {
  let lastTime = -1;
  let lastRandom = new Uint8Array(10);
  return (now: number = Date.now()): string => {
    if (now <= lastTime) {
      /** 乱数部を 1 増やす（80ビットの繰り上がり付き加算） */
      let i = 9;
      while (i >= 0 && lastRandom[i] === 255) lastRandom[i--] = 0;
      if (i < 0) throw new Error('同じミリ秒内で生成できる上限を超えました');
      lastRandom[i] = (lastRandom[i] ?? 0) + 1;
    } else {
      lastTime = now;
      lastRandom = randomBytes(10, rng);
    }
    return encodeUlidTime(lastTime) + encodeUlidRandom(lastRandom);
  };
}

/** 解析 */

/** 時刻を取り出せた状態・時刻を持たない形式・解析未対応の形式を区別する。 */
type InspectedTime = { timeStatus: 'decoded'; time: number } | { timeStatus: 'absent' | 'unsupported'; time?: never };

export type Inspection =
  | ({ kind: 'uuid'; version: number; variant: string; canonical: string } & InspectedTime)
  | { kind: 'ulid'; timeStatus: 'decoded'; time: number; canonical: string };

const UUID_RE = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** UUID / ULID を判定し、バージョンや埋め込まれた時刻を取り出す */
export function inspectId(input: string): Inspection {
  const s = input.trim();
  const body = s.startsWith('{') && s.endsWith('}') ? s.slice(1, -1) : s;
  if (UUID_RE.test(body)) {
    const h = body.replace(/-/g, '').toLowerCase();
    const version = parseInt(h.charAt(12), 16);
    const v = parseInt(h.charAt(16), 16);
    const variant = v < 8 ? 'NCS（旧形式）' : v < 12 ? 'RFC 9562' : v < 14 ? 'Microsoft' : '予約';
    const canonical = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    const base = { kind: 'uuid' as const, version, variant, canonical };
    if (variant === 'RFC 9562') {
      if (version === 7) return { ...base, timeStatus: 'decoded', time: parseInt(h.slice(0, 12), 16) };
      if (version === 1 || version === 6) {
        /** RFC 9562 §5.1・5.6：同じ60ビットの時刻（1582-10-15 から100ナノ秒単位）で、格納順だけが違う。 */
        const timestamp = version === 1 ? h.slice(13, 16) + h.slice(8, 12) + h.slice(0, 8) : h.slice(0, 12) + h.slice(13, 16);
        const time = Number((BigInt(`0x${timestamp}`) - 122192928000000000n) / 10000n);
        return { ...base, timeStatus: 'decoded', time };
      }
      if (version === 3 || version === 4 || version === 5) return { ...base, timeStatus: 'absent' };
    }
    return { ...base, timeStatus: 'unsupported' };
  }

  const upper = s.toUpperCase();
  if (/^[0-9A-HJKMNP-TV-Z]{26}$/.test(upper)) {
    let time = 0;
    for (const c of upper.slice(0, 10)) time = time * 32 + ULID_ALPHABET.indexOf(c);
    if (time > MAX_TIME) throw new Error('ULIDとして不正です（時刻部分が範囲外）');
    return { kind: 'ulid', timeStatus: 'decoded', time, canonical: upper };
  }
  throw new Error('UUID（36文字／ハイフンなし32文字）またはULID（26文字）を入力してください');
}
