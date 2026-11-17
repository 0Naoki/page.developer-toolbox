/** 検査の対象：parse.ts・describe.ts・nextRuns.ts（このツールに logic.ts はない）（専用のテストファイルを置かないファイルも、ここでまとめて検査する） */
import { describe, expect, it } from 'vitest';
import { formatInZone } from '../../lib/time/dateTimeFormat';
import { parseDateTime } from '../../lib/time/dateTimeInput';
import { limitMessage } from '../../lib/text/textPreview';
import { cronWarnings, describeCron, fieldRows } from './describe';
import { formatRun, nextRuns } from './nextRuns';
import { MAX_INPUT, parseCron, type Dialect } from './parse';

const JST = 'Asia/Tokyo';
const at = (text: string) => Date.parse(text);
/** 基準日時の後の実行日時を JST の文字列で返す */
const runs = (expr: string, from: string, count = 3, dialect: Dialect = 'unix', zone = JST) =>
  nextRuns(parseCron(expr, dialect), zone, at(from), count).map((ms) => formatInZone(new Date(ms), JST));
const describeOf = (expr: string, dialect: Dialect = 'unix') => describeCron(parseCron(expr, dialect));

it('Date の下限より前の現地日付でも、次の実行を飛ばさない', () => {
  const actual = nextRuns(parseCron('0 17 * * *', 'unix'), 'America/Phoenix', -8640000000000000, 1);
  expect(actual.map((ms) => new Date(ms).toISOString())).toEqual(['-271821-04-20T00:28:18.000Z']);
});

describe('parseCron', () => {
  it('Kubernetes は単一値からの間隔と ? を読み、曜日は 0〜6 に限る', () => {
    expect(parseCron('5/15 ? ? * SUN', 'kubernetes').fields.map((f) => f.values)).toEqual([
      [5, 20, 35, 50], Array.from({ length: 24 }, (_, i) => i), Array.from({ length: 31 }, (_, i) => i + 1), expect.any(Array), [0],
    ]);
    expect(parseCron('?/15 * * * *', 'kubernetes').fields[0]?.values).toEqual([0, 15, 30, 45]);
    expect(parseCron('@daily', 'kubernetes').expanded).toBe('0 0 * * *');
    for (const expr of ['0 0 * * 7', '30-10 * * * *', '0 0 L * *', '0 0 * * MON#2']) {
      expect(() => parseCron(expr, 'kubernetes'), expr).toThrow();
    }
  });

  it.each([
    ['* * * * *', 5],
    ['*/5 1,2 1-5 JAN-MAR mon-fri', 5],
    ['0 9 * * 7', 5],
  ])('標準の cron：%s', (expr, length) => {
    expect(parseCron(expr, 'unix').fields).toHaveLength(length);
  });

  it('前後の空白と大文字小文字を問わない', () => {
    expect(parseCron('  0   9 * jan   mon ', 'unix').fields.map((f) => f.values)).toEqual([[0], [9], expect.any(Array), [1], [1]]);
  });

  it('曜日の 0 と 7 は日曜で、* は日曜を重ねない', () => {
    expect(parseCron('0 0 * * 7', 'unix').fields[4]?.values).toEqual([0]);
    expect(parseCron('0 0 * * 5-7', 'unix').fields[4]?.values).toEqual([0, 5, 6]);
    expect(parseCron('0 0 * * */2', 'unix').fields[4]?.values).toEqual([0, 2, 4, 6]);
  });

  it('Quartz と EventBridge の曜日は SUN=1', () => {
    expect(parseCron('0 0 0 ? * 1', 'quartz').fields[5]?.values).toEqual([0]);
    expect(parseCron('0 0 ? * SUN *', 'aws').fields[4]?.values).toEqual([0]);
    expect(parseCron('0 0 0 ? * MON-FRI', 'quartz').fields[5]?.values).toEqual([1, 2, 3, 4, 5]);
  });

  it('Quartz は開始が終了より後の範囲を折り返す', () => {
    expect(parseCron('0 0 0 ? * FRI-MON', 'quartz').fields[5]?.values).toEqual([0, 1, 5, 6]);
    expect(parseCron('0 0 22-2 * * ?', 'quartz').fields[2]?.values).toEqual([0, 1, 2, 22, 23]);
  });

  it('Quartz は秒から始まり、年は省略できる', () => {
    expect(parseCron('0 0 9 * * ?', 'quartz').fields.map((f) => f.name)).toEqual(['second', 'minute', 'hour', 'day', 'month', 'weekday']);
    expect(parseCron('0 0 9 * * ? 2027', 'quartz').fields[6]?.values).toEqual([2027]);
  });

  it('EventBridge の cron(...) を外して読む', () => {
    expect(parseCron('cron(0 9 * * ? *)', 'aws').fields).toHaveLength(6);
  });

  it('マクロを展開する', () => {
    expect(parseCron('@daily', 'unix').expanded).toBe('0 0 * * *');
    expect(parseCron('@HOURLY', 'unix').expanded).toBe('0 * * * *');
  });

  it.each([
    ['', 'unix', '5項目'],
    ['0 9 * *', 'unix', '5項目'],
    ['0 9 * * * /bin/job', 'unix', 'コマンドは含めない'],
    ['60 * * * *', 'unix', '分の「60」が範囲外'],
    ['0 24 * * *', 'unix', '時の「24」が範囲外'],
    ['0 0 0 * *', 'unix', '日の「0」が範囲外'],
    ['0 0 32 * *', 'unix', '範囲外'],
    ['0 0 * 13 *', 'unix', '月の「13」が範囲外'],
    ['0 0 * * 8', 'unix', '曜日の「8」が範囲外'],
    ['0 0 * FOO *', 'unix', '「FOO」を読めません'],
    ['*/0 * * * *', 'unix', '間隔は1以上'],
    ['1/2/3 * * * *', 'unix', '読めません'],
    ['1-2-3 * * * *', 'unix', '読めません'],
    ['5,, * * * *', 'unix', '空の項目'],
    ['5/15 * * * *', 'unix', '「5-59/15」と書いて'],
    ['30-10 * * * *', 'unix', '開始が終了より後'],
    ['0 9 ? * *', 'unix', '? は使えません'],
    ['0 9 L * *', 'unix', '「L」を読めません'],
    ['@reboot', 'unix', '@reboot'],
    ['@foo', 'unix', '知らないマクロ'],
    ['@daily', 'aws', '標準の cron と Kubernetes'],
    ['0 0 9 * *', 'quartz', '6項目'],
    ['0 0 9 * * *', 'quartz', '? にしてください'],
    ['0 0 9 ? * ?', 'quartz', '? にしてください'],
    ['? 0 9 * * ?', 'quartz', '日と曜日にだけ'],
    ['0 0 0 ? * 8', 'quartz', '範囲外'],
    ['0 0 0 ? * 6#6', 'quartz', '第1〜第5'],
    ['0 0 0 L-31 * ?', 'quartz', '範囲外'],
    ['0 9 * * *', 'aws', '6項目'],
    ['0 9 * * ? 1969', 'aws', '年の「1969」が範囲外'],
    ['x'.repeat(MAX_INPUT + 1), 'unix', '文字までです'],
  ] as [string, Dialect, string][])('「%s」（%s）はエラー', (expr, dialect, message) => {
    expect(() => parseCron(expr, dialect)).toThrow(message);
  });

  /** 上限ちょうどの長い入力でも、表示の上限（MESSAGE_LIMIT）で末尾の理由が切れないよう、入力を抜粋にする */
  it.each([
    ['@' + 'x'.repeat(MAX_INPUT - 1), 'は知らないマクロです（@yearly・@monthly・@weekly・@daily・@hourly が使えます）'],
    ['1,' + ','.repeat(MAX_INPUT - 10) + ' * * * *', 'に空の項目があります'],
  ])('上限の長さの入力（%#）でも、文言の末尾に理由が残る', (expr, reason) => {
    expect(expr.length).toBeLessThanOrEqual(MAX_INPUT);
    let message = '';
    try {
      parseCron(expr, 'unix');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(limitMessage(message)).toBe(message);
    expect(message.endsWith(reason)).toBe(true);
  });
});

describe('nextRuns', () => {
  it('Kubernetes の N/step と日・曜日の OR を計算する', () => {
    expect(runs('5/15 * * * *', '2026-10-02T09:00:00+09:00', 3, 'kubernetes')).toEqual([
      '2026-10-02 09:05:00', '2026-10-02 09:20:00', '2026-10-02 09:35:00',
    ]);
    expect(runs('0 0 */2 * FRI', '2026-10-02T12:00:00+09:00', 3, 'kubernetes')).toEqual([
      '2026-10-03 00:00:00', '2026-10-05 00:00:00', '2026-10-07 00:00:00',
    ]);
    expect(runs('0 0 ? * FRI', '2026-10-02T12:00:00+09:00', 2, 'kubernetes')).toEqual([
      '2026-10-09 00:00:00', '2026-10-16 00:00:00',
    ]);
  });

  it('基準日時より後の実行を早い順に返す', () => {
    expect(runs('0 9 * * *', '2026-10-02T09:00:00+09:00')).toEqual(['2026-10-03 09:00:00', '2026-10-04 09:00:00', '2026-10-05 09:00:00']);
    expect(runs('*/15 * * * *', '2026-10-02T09:07:30+09:00')).toEqual(['2026-10-02 09:15:00', '2026-10-02 09:30:00', '2026-10-02 09:45:00']);
  });

  it('基準日時と同じ秒の実行は含まない', () => {
    expect(runs('* * * * *', '2026-10-02T09:00:00.500+09:00', 1)).toEqual(['2026-10-02 09:01:00']);
  });

  it('月末・年末をまたぐ', () => {
    expect(runs('30 23 31 12 *', '2026-12-31T23:30:00+09:00', 1)).toEqual(['2027-12-31 23:30:00']);
    expect(runs('0 0 1 * *', '2026-12-15T00:00:00+09:00', 2)).toEqual(['2027-01-01 00:00:00', '2027-02-01 00:00:00']);
  });

  it('UTC の式を JST で表示できる（GitHub Actions など）', () => {
    expect(runs('0 0 * * *', '2026-10-02T12:00:00+09:00', 1, 'unix', 'UTC')).toEqual(['2026-10-03 09:00:00']);
    /** UTC の金曜 15:00 は JST の土曜 0:00 */
    expect(runs('0 15 * * 5', '2026-10-01T00:00:00+09:00', 1, 'unix', 'UTC')).toEqual(['2026-10-03 00:00:00']);
  });

  it('標準の cron は日と曜日のどちらかに一致すれば実行する', () => {
    /** 2026-10-02 は金曜 */
    expect(runs('0 0 13 * 5', '2026-10-02T12:00:00+09:00', 3)).toEqual(['2026-10-09 00:00:00', '2026-10-13 00:00:00', '2026-10-16 00:00:00']);
  });

  it('* で始まる日は指定なしとして、曜日との両方に一致した日だけ実行する', () => {
    /** 2026-10 の奇数日かつ金曜：9・23 日 */
    expect(runs('0 0 */2 * 5', '2026-10-02T12:00:00+09:00', 2)).toEqual(['2026-10-09 00:00:00', '2026-10-23 00:00:00']);
  });

  it('うるう年の2月29日', () => {
    expect(runs('0 0 29 2 *', '2026-01-01T00:00:00+09:00', 2)).toEqual(['2028-02-29 00:00:00', '2032-02-29 00:00:00']);
  });

  it('実行されない式は空を返し、すぐに終わる', () => {
    expect(runs('0 0 31 2 *', '2026-01-01T00:00:00+09:00')).toEqual([]);
    expect(runs('0 0 30 2 ? *', '2026-01-01T00:00:00+09:00', 3, 'aws')).toEqual([]);
    expect(runs('0 0 1 1 ? 2000', '2026-01-01T00:00:00+09:00', 3, 'aws')).toEqual([]);
  });

  it('秒の指定と年の指定', () => {
    expect(runs('*/20 * * * * ?', '2026-10-02T09:00:05+09:00', 2, 'quartz')).toEqual(['2026-10-02 09:00:20', '2026-10-02 09:00:40']);
    expect(runs('0 0 0 1 1 ? 2030', '2026-10-02T09:00:05+09:00', 3, 'quartz')).toEqual(['2030-01-01 00:00:00']);
  });

  describe('Quartz・EventBridge の特殊文字', () => {
    const q = (expr: string, from: string, count = 3) => runs(expr, from, count, 'quartz');

    it('L は月末、L-n はその n 日前', () => {
      expect(q('0 0 0 L * ?', '2026-01-31T12:00:00+09:00', 2)).toEqual(['2026-02-28 00:00:00', '2026-03-31 00:00:00']);
      expect(q('0 0 0 L-2 * ?', '2026-02-01T00:00:00+09:00', 1)).toEqual(['2026-02-26 00:00:00']);
      expect(q('0 0 0 L * ?', '2028-02-01T00:00:00+09:00', 1)).toEqual(['2028-02-29 00:00:00']);
    });

    it('LW は月末の平日', () => {
      /** 2026-02-28 は土曜、2026-05-31 は日曜 */
      expect(q('0 0 0 LW * ?', '2026-02-01T00:00:00+09:00', 1)).toEqual(['2026-02-27 00:00:00']);
      expect(q('0 0 0 LW * ?', '2026-05-01T00:00:00+09:00', 1)).toEqual(['2026-05-29 00:00:00']);
    });

    it('nW は最も近い平日で、月をまたがない', () => {
      /** 2026-08-15 は土曜 → 14日。2026-08-16 は日曜 → 17日 */
      expect(q('0 0 0 15W * ?', '2026-08-01T00:00:00+09:00', 1)).toEqual(['2026-08-14 00:00:00']);
      expect(q('0 0 0 16W * ?', '2026-08-01T00:00:00+09:00', 1)).toEqual(['2026-08-17 00:00:00']);
      /** 2026-08-01 は土曜 → 3日。2026-05-31 は日曜 → 29日 */
      expect(q('0 0 0 1W * ?', '2026-07-31T12:00:00+09:00', 1)).toEqual(['2026-08-03 00:00:00']);
      expect(q('0 0 0 31W * ?', '2026-05-01T00:00:00+09:00', 1)).toEqual(['2026-05-29 00:00:00']);
    });

    it('nW は、その日がない月には実行しない（LW と違い月末に置き換えない）', () => {
      /** 2月・4月に31日はない。2026-03-31 は火曜、2026-05-31 は日曜 → 29日 */
      expect(q('0 0 0 31W * ?', '2026-02-01T00:00:00+09:00', 2)).toEqual(['2026-03-31 00:00:00', '2026-05-29 00:00:00']);
    });

    it('6L は最終金曜日、6#3 は第3金曜日', () => {
      expect(q('0 0 0 ? * 6L', '2026-10-01T00:00:00+09:00', 1)).toEqual(['2026-10-30 00:00:00']);
      expect(q('0 0 0 ? * 6#3', '2026-10-01T00:00:00+09:00', 1)).toEqual(['2026-10-16 00:00:00']);
      expect(q('0 0 0 ? * FRI#3', '2026-10-01T00:00:00+09:00', 1)).toEqual(['2026-10-16 00:00:00']);
    });

    it('第5がない月は飛ばす', () => {
      /** 2026 年の第5金曜：1・5・7・10月… */
      expect(q('0 0 0 ? * 6#5', '2026-02-01T00:00:00+09:00', 1)).toEqual(['2026-05-29 00:00:00']);
    });

    it('曜日の L だけなら毎週土曜日。最終土曜日は 7L', () => {
      expect(q('0 0 0 ? * L', '2026-10-01T00:00:00+09:00', 2)).toEqual(['2026-10-03 00:00:00', '2026-10-10 00:00:00']);
      expect(runs('0 0 ? * L *', '2026-10-01T00:00:00+09:00', 2, 'aws')).toEqual(['2026-10-03 00:00:00', '2026-10-10 00:00:00']);
      expect(q('0 0 0 ? * 7L', '2026-10-01T00:00:00+09:00', 1)).toEqual(['2026-10-31 00:00:00']);
    });
  });

  describe('夏時間', () => {
    const NY = 'America/New_York';
    const utc = (expr: string, from: string, count: number) =>
      nextRuns(parseCron(expr, 'unix'), NY, at(from), count).map((ms) => new Date(ms).toISOString());

    it('飛ばされる時刻は実行しない', () => {
      /** 2026-03-08 02:00 に 03:00 へ飛ぶ */
      expect(utc('30 2 * * *', '2026-03-07T12:00:00-05:00', 2)).toEqual(['2026-03-09T06:30:00.000Z', '2026-03-10T06:30:00.000Z']);
    });

    it('2回ある時刻は1回目だけ実行する', () => {
      /** 2026-11-01 02:00（夏時間）に 01:00 へ戻る */
      expect(utc('30 1 * * *', '2026-10-31T12:00:00-04:00', 2)).toEqual(['2026-11-01T05:30:00.000Z', '2026-11-02T06:30:00.000Z']);
    });

    it('2回ある時刻の2回目から探しても、過去の時刻を返さない', () => {
      const from = '2026-11-01T06:10:00.000Z'; /** 2回目の 01:10 */
      const result = utc('*/15 * * * *', from, 1);
      expect(Date.parse(result[0]!)).toBeGreaterThan(Date.parse(from));
    });
  });
});

describe('formatRun', () => {
  it('曜日を、表示するタイムゾーンの現地の日付で決める（日本時間と UTC で日付がまたがる時刻）', () => {
    /** 2026-10-05（月）00:30 JST は、UTC では 2026-10-04（日）15:30 */
    const ms = at('2026-10-04T15:30:00Z');
    expect(formatRun(ms, JST)).toBe(`${formatInZone(new Date(ms), JST)}（月）`);
    expect(formatRun(ms, 'UTC')).toBe(`${formatInZone(new Date(ms), 'UTC')}（日）`);
    expect(formatRun(ms, JST)).toContain('2026-10-05');
    expect(formatRun(ms, 'UTC')).toContain('2026-10-04');
  });

  it('回帰：表示した次回の実行日時を、基準日時（日本時間として読む）に貼り戻しても同じ時刻になる', () => {
    /** 曜日の添え書きで読めず、日本時間以外の列はオフセットがないため、日本時間として読んで時刻がずれていた */
    const ms = at('2026-10-04T15:30:00Z');
    expect(parseDateTime(formatRun(ms, JST), JST).getTime()).toBe(ms);
    /** コピーのボタンの形（「…（月） JST」） */
    expect(parseDateTime(`${formatRun(ms, JST)} JST`, JST).getTime()).toBe(ms);
    for (const zone of ['UTC', 'America/New_York', 'Asia/Kolkata']) {
      const shown = formatRun(ms, zone, true);
      expect(parseDateTime(shown, JST).getTime(), shown).toBe(ms);
    }
    expect(formatRun(ms, 'America/New_York', true)).toBe('2026-10-04 11:30:00 -04:00（日）');
  });
});

describe('describeCron', () => {
  it.each([
    ['* * * * *', '毎分'],
    ['*/5 * * * *', '5分ごと'],
    ['30 * * * *', '毎時30分'],
    ['0 9 * * *', '毎日 09:00'],
    ['5 18 * * *', '毎日 18:05'],
    ['0 9 * * 1-5', '毎週月〜金曜日 09:00'],
    ['0 9 * * MON,WED,FRI', '毎週月、水、金曜日 09:00'],
    ['0 9 1 * *', '毎月1日 09:00'],
    ['0 0 1,15 * *', '毎月1、15日 00:00'],
    ['0 0 1 1 *', '1月1日 00:00'],
    ['0 0 * 4 *', '4月の毎日 00:00'],
    ['*/15 9-17 * * 1-5', '毎週月〜金曜日 9〜17時の15分ごと'],
    ['0 */2 * * *', '毎日 2時間ごとの0分'],
    ['* 9 * * *', '毎日 9時台の毎分'],
    ['0,30 9,18 * * *', '毎日 9、18時の0、30分'],
    ['10-20/2 * * * *', '毎時10〜20分の2分ごと'],
    ['0 0 13 * 5', '毎月13日または金曜日 00:00'],
    ['0 0 */2 * 5', '毎月2日ごとかつ金曜日 00:00'],
    ['@weekly', '毎週日曜日 00:00'],
  ])('%s → %s', (expr, text) => {
    expect(describeOf(expr)).toBe(text);
  });

  it.each([
    ['0 0 9 * * ?', '毎日 09:00'],
    ['30 15 9 * * ?', '毎日 09:15:30'],
    ['* * * * * ?', '毎秒'],
    ['*/10 * * * * ?', '10秒ごと'],
    ['15 * * * * ?', '毎分15秒'],
    ['0 0 0 L * ?', '毎月月末 00:00'],
    ['0 0 0 L-3 * ?', '毎月月末の3日前 00:00'],
    ['0 0 0 LW * ?', '毎月月末の平日 00:00'],
    ['0 0 0 15W * ?', '毎月15日に最も近い平日 00:00'],
    ['0 0 0 ? * L', '毎週土曜日 00:00'],
    ['0 0 0 ? * 6L', '毎月最終金曜日 00:00'],
    ['0 0 0 ? * 6#3', '毎月第3金曜日 00:00'],
    ['0 0 0 1 1 ? 2030', '2030年1月1日 00:00'],
  ])('Quartz：%s → %s', (expr, text) => {
    expect(describeOf(expr, 'quartz')).toBe(text);
  });

  it('EventBridge の曜日は SUN=1 として読み下す', () => {
    expect(describeOf('0 3 ? * 2-6 *', 'aws')).toBe('毎週月〜金曜日 03:00');
  });
});

describe('fieldRows', () => {
  it('項目ごとの値を一覧にする', () => {
    expect(fieldRows(parseCron('*/20 9 * JAN 1-2', 'unix'))).toEqual([
      { label: '分', source: '*/20', meaning: '0、20、40分' },
      { label: '時', source: '9', meaning: '9時' },
      { label: '日', source: '*', meaning: 'すべて' },
      { label: '月', source: 'JAN', meaning: '1月' },
      { label: '曜日', source: '1-2', meaning: '月、火曜日' },
    ]);
  });

  it('? と特殊文字', () => {
    const rows = fieldRows(parseCron('0 0 0 ? * 6L', 'quartz'));
    expect(rows[3]?.meaning).toBe('指定なし');
    expect(rows[5]?.meaning).toBe('最終金曜日');
  });
});

describe('cronWarnings', () => {
  it('日と曜日の両方を指定すると注意する', () => {
    expect(cronWarnings(parseCron('0 0 13 * 5', 'unix'))[0]).toContain('どちらかに一致');
    expect(cronWarnings(parseCron('0 0 */2 * 5', 'unix'))[0]).toContain('実装で動作が異なります');
    expect(cronWarnings(parseCron('0 0 13 * *', 'unix'))).toEqual([]);
  });

  it('その日がない月があることを注意する（nW も同じ）', () => {
    expect(cronWarnings(parseCron('0 0 31 * *', 'unix'))).toEqual(['31日がない月には実行されません']);
    expect(cronWarnings(parseCron('0 0 0 31W * ?', 'quartz'))).toEqual(['31日がない月には実行されません']);
    expect(cronWarnings(parseCron('0 0 0 28W * ?', 'quartz'))).toEqual([]);
    expect(cronWarnings(parseCron('0 0 0 L * ?', 'quartz'))).toEqual([]);
    expect(cronWarnings(parseCron('0 0 0 ? * 2', 'quartz'))).toEqual([]);
  });

  it('割り切れない間隔を注意する', () => {
    expect(cronWarnings(parseCron('*/45 * * * *', 'unix'))).toEqual(['分の */45 は、区切りごとに数え直すため間隔が一定になりません（45分の次は0分）']);
    expect(cronWarnings(parseCron('*/15 * * * *', 'unix'))).toEqual([]);
    expect(cronWarnings(parseCron('0 */5 * * *', 'unix'))[0]).toContain('20時の次は0時');
  });

  it('月によっては存在しない日を注意する', () => {
    expect(cronWarnings(parseCron('0 0 31 * *', 'unix'))).toEqual(['31日がない月には実行されません']);
    expect(cronWarnings(parseCron('0 0 28 * *', 'unix'))).toEqual([]);
  });
});

describe('Date の上限の近くの探索', () => {
  it('Date で表せる範囲を超えたら、範囲外の候補を試し続けずに探索を終える', () => {
    const started = performance.now();
    /** 日が13日か月曜日（標準の cron は OR）。+275760-09-12 は月曜日ではないため、上限の 09-13 00:00 だけが実行時刻になる */
    const runs = nextRuns(parseCron('* * 13 * 1', 'unix'), 'UTC', Date.parse('+275760-09-12T23:58:00Z'), 5);
    expect(runs.map((ms) => new Date(ms).toISOString())).toEqual(['+275760-09-13T00:00:00.000Z']);
    /** 修正前は、範囲外の候補を200年分（数千万回）試して、数十秒以上かかった */
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('タイムゾーンのずれで上限を超える壁時計も、範囲外として探索を終える', () => {
    const runs = nextRuns(parseCron('* * * * *', 'unix'), 'Asia/Tokyo', Date.parse('+275760-09-12T23:58:00Z'), 5);
    expect(runs.map((ms) => new Date(ms).toISOString())).toEqual(['+275760-09-12T23:59:00.000Z', '+275760-09-13T00:00:00.000Z']);
  });
});
