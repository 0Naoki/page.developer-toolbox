/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - [R050] パスワードの一括生成 × Unicode・除外・必須文字種：個別生成と同じ乱数の流れと条件を保つ
 *   不正なサロゲートは保存値の復元時も拒否する。小さな集合の全生成経路で文字数・候補・確率の上限を確かめる。
 */
import { describe, expect, it } from 'vitest';
import {
  createPasswordPlan,
  isPasswordOptions,
  AMBIGUOUS,
  CHARSETS,
  DEFAULT_OPTIONS,
  pinEntropyBits,
  generateMany,
  generatePin,
  randomInt,
  strengthOf,
  type PasswordOptions,
  type Rng,
} from './logic';

/** 決められた値を順番に返す乱数源 */
const sequenceRng =
  (values: number[]): Rng =>
  (buf) => {
    for (let i = 0; i < buf.length; i++) buf[i] = values.shift() ?? 0;
  };

const opts = (o: Partial<PasswordOptions>): PasswordOptions => ({ ...DEFAULT_OPTIONS, ...o });

/** 画面と同じく、生成計画（createPasswordPlan）を通して検証・文字集合・生成・強度を確かめる */
const planOf = (o: PasswordOptions) => {
  const plan = createPasswordPlan(o);
  if (!plan.ok) throw new Error(plan.error);
  return plan;
};
const validate = (o: PasswordOptions) => createPasswordPlan(o).error;
const generatePassword = (o: PasswordOptions, rng?: Rng) => planOf(o).generate(rng);
const buildPools = (o: PasswordOptions) => planOf(o).pools.map((p) => p.join(''));
const entropyBits = (o: PasswordOptions) => createPasswordPlan(o).bits;

describe('randomInt', () => {
  it('偏りの出る範囲の値は捨てて引き直す', () => {
    /** max=3 のとき 2^32 - 1 は棄却対象（2^32 % 3 = 1） */
    expect(randomInt(3, sequenceRng([2 ** 32 - 1, 7]))).toBe(1);
  });

  it('暗号論的乱数でおおむね均等に分布する', () => {
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 60000; i++) counts[randomInt(6)]! += 1;
    for (const c of counts) expect(c > 9400 && c < 10600).toBe(true);
  });

  it('不正な上限はエラー', () => {
    expect(() => randomInt(0)).toThrow();
  });
});

describe('buildPools', () => {
  it('見間違えやすい文字を除外する', () => {
    const all = buildPools(opts({})).join('');
    for (const c of AMBIGUOUS) expect(all.includes(c)).toBe(false);
  });

  it('個別の除外文字を反映する', () => {
    const pools = buildPools(opts({ upper: false, lower: false, symbols: false, excludeAmbiguous: false, exclude: '0123' }));
    expect(pools).toEqual(['456789']);
  });

  it('記号セットを差し替えられる', () => {
    const pools = buildPools(opts({ upper: false, lower: false, digits: false, symbolSet: '-_' }));
    expect(pools).toEqual(['-_']);
  });
});

describe('validate', () => {
  it('対になっていないサロゲートを含む文字集合・除外文字を、保存値の復元時も拒否する', () => {
    for (const field of ['symbolSet', 'exclude'] as const) {
      for (const value of ['\ud83d-\ude00😀', '\ud83d', '\ude00']) {
        const o = opts({ [field]: value });
        expect(validate(o)).not.toBeNull();
        expect(isPasswordOptions(JSON.parse(JSON.stringify(o)))).toBe(false);
        expect(createPasswordPlan(o).ok).toBe(false);
        expect(() => generatePassword(o)).toThrow();
      }
    }
  });
  it('必須の文字種が除外設定で空になる場合は生成しない', () => {
    for (const exclude of [CHARSETS.upper, CHARSETS.lower, CHARSETS.digits, CHARSETS.symbols]) {
      const o = opts({ exclude });
      expect(validate(o), exclude).not.toBeNull();
      expect(() => generatePassword(o), exclude).toThrow();
    }
    /** 見間違えやすい文字の除外で、記号がすべて消える場合も同じ */
    expect(validate(opts({ symbolSet: '|' }))).not.toBeNull();
  });

  it('文字種を必須にしなければ、空になった文字種以外で生成できる', () => {
    const o = opts({ exclude: CHARSETS.digits, requireEach: false });
    expect(validate(o)).toBeNull();
    const password = generatePassword(o);
    expect(password).toHaveLength(o.length);
    expect(password).not.toMatch(/[0-9]/);
    expect(validate(opts({ digits: false, exclude: CHARSETS.digits }))).toBeNull();
  });

  it('文字種が0ならエラー', () => {
    expect(validate(opts({ upper: false, lower: false, digits: false, symbols: false }))).not.toBe(null);
  });

  it('長さの範囲外はエラー', () => {
    expect(validate(opts({ length: 3 }))).not.toBe(null);
    expect(validate(opts({ length: 129 }))).not.toBe(null);
    expect(validate(opts({ length: 4 }))).toBe(null);
  });
});

describe('generatePassword', () => {
  it('一括生成でも乱数源を継続して使い、個別生成と同じ必須文字・Unicode・除外の条件を保つ', () => {
    const o = opts({ symbolSet: '😀🔑!😀', exclude: 'A0🔑', length: 12 });
    const stream = (): Rng => {
      let next = 0;
      return (buf) => { for (let i = 0; i < buf.length; i++) buf[i] = next++; };
    };
    const rng = stream();
    const separate = Array.from({ length: 20 }, () => generatePassword(o, rng));
    const batch = generateMany(o, 20, stream());
    expect(batch).toEqual(separate);
    for (const password of batch) {
      expect(Array.from(password)).toHaveLength(12);
      expect(password).not.toMatch(/[A0🔑]/u);
      for (const pool of buildPools(o)) expect(Array.from(password).some((c) => Array.from(pool).includes(c))).toBe(true);
    }
  });
  it('指定した長さで生成する', () => {
    for (const length of [4, 16, 64, 128]) expect(generatePassword(opts({ length })).length).toBe(length);
  });

  it('選んだ文字種をすべて含む', () => {
    for (let i = 0; i < 300; i++) {
      const p = generatePassword(opts({ length: 4 }));
      expect(/[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p)).toBe(true);
    }
  });

  it('許可していない文字を含まない', () => {
    const o = opts({ symbols: false, exclude: 'abc' });
    const allowed = new Set(buildPools(o).join(''));
    for (const p of generateMany(o, 200)) for (const c of p) expect(allowed.has(c)).toBe(true);
  });

  it('数字のみも生成できる', () => {
    const p = generatePassword(opts({ upper: false, lower: false, symbols: false, length: 20 }));
    expect(/^[2-9]{20}$/.test(p)).toBe(true);
  });

  it('設定が不正ならエラー', () => {
    expect(() => generatePassword(opts({ length: 2 }))).toThrow();
  });

  it('同じ値が続かない（衝突しない）', () => {
    expect(new Set(generateMany(DEFAULT_OPTIONS, 1000)).size).toBe(1000);
  });
});

describe('絵文字などを記号に指定したとき', () => {
  const emojiOnly = opts({ upper: false, lower: false, digits: false, symbolSet: '😀🔑', length: 8 });

  it('壊れた文字（サロゲートペアの片割れ）を含めず、指定した文字数にする', () => {
    for (let i = 0; i < 50; i++) {
      const pw = generatePassword(emojiOnly);
      /** 片割れが混じると、1文字ずつに分けたときに 😀 でも 🔑 でもない文字が出る */
      expect(Array.from(pw).every((c) => c === '😀' || c === '🔑'), pw).toBe(true);
      expect(Array.from(pw).length).toBe(8);
    }
  });

  it('エントロピーは1文字を1種類として数える', () => {
    expect(entropyBits(emojiOnly)).toBe(8);
  });
});

describe('generatePin', () => {
  it('数字のみで指定桁数', () => {
    expect(/^\d{6}$/.test(generatePin(6))).toBe(true);
  });

  it('桁数が範囲外ならエラー', () => {
    expect(() => generatePin(3)).toThrow();
  });
});

describe('entropyBits / strengthOf', () => {
  it('生成計画は設定を確定し、重なる文字集合でも最頻出値の確率を過小評価しない', () => {
    for (const alphabet of ['!?', 'AB', '😀🔑', 'é\u0301']) {
      const overlapping = alphabet === 'AB';
      const o = opts({ length: 4, upper: true, lower: false, digits: false, symbols: true, excludeAmbiguous: false,
        symbolSet: alphabet, exclude: overlapping ? 'CDEFGHIJKLMNOPQRSTUVWXYZ' : 'BCDEFGHIJKLMNOPQRSTUVWXYZ' });
      const plan = createPasswordPlan(o);
      if (!plan.ok) throw new Error(plan.error);
      o.length = 100;
      const widths = overlapping ? [2, 2, 2, 2, 4, 3, 2] : [1, 2, 3, 3, 4, 3, 2];
      const counts = new Map<string, number>();
      let paths = 0;
      const visit = (choices: number[]) => {
        if (choices.length < widths.length) {
          for (let i = 0; i < widths[choices.length]!; i++) visit([...choices, i]);
          return;
        }
        let index = 0;
        const value = plan.generate((buffer) => { buffer[0] = choices[index++]!; });
        const characters = Array.from(value);
        expect(characters).toHaveLength(4);
        const allowed = new Set(['A', ...alphabet, ...(overlapping ? ['B'] : [])]);
        expect(characters.every((c) => allowed.has(c))).toBe(true);
        counts.set(value, (counts.get(value) ?? 0) + 1);
        paths++;
      };
      visit([]);
      for (const count of counts.values()) expect(count / paths).toBeLessThanOrEqual(2 ** -plan.bits + 1e-12);
    }
  });
  it('必須文字種が偏った設定でも、候補数を超える強度を示さない', () => {
    const symbolSet = Array.from({ length: 100_000 }, (_, i) => String.fromCodePoint(0x10000 + i)).join('');
    const o = opts({ length: 4, excludeAmbiguous: false, symbolSet, requireEach: true });
    expect(validate(o)).toBeNull();
    expect(entropyBits(o)).toBeLessThanOrEqual(Math.log2(24 * 26 * 26 * 10 * 100_000));
    expect(strengthOf(entropyBits(o)).label).toBe('弱い');
  });
  it('PIN は桁数 × log2(10) で計算する（6桁は約19.9ビットで「弱い」）', () => {
    expect(pinEntropyBits(6)).toBeCloseTo(19.93, 2);
    expect(strengthOf(pinEntropyBits(6)).label).toBe('弱い');
    expect(pinEntropyBits(32)).toBeCloseTo(106.3, 1);
  });

  it('長さ × log2(文字の種類数) で計算する', () => {
    const o = opts({ upper: false, lower: true, digits: false, symbols: false, excludeAmbiguous: false, length: 10 });
    expect(Math.round(entropyBits(o) * 100) / 100).toBe(47);
    expect(CHARSETS.lower.length).toBe(26);
  });

  it('強度を判定する', () => {
    expect(strengthOf(30).label).toBe('弱い');
    expect(strengthOf(59.9).label).toBe('普通');
    expect(strengthOf(70).label).toBe('強い');
    expect(strengthOf(100).label).toBe('非常に強い');
  });
});
