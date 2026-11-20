/** 検査の対象：logic.ts・diagnostics.ts（専用のテストファイルを置かないファイルも、ここでまとめて検査する） */
import { describe, expect, it } from 'vitest';
import { claimRows, decodeJwe, judgeJwt, parseJwt } from './logic';
import { headerWarnings } from './diagnostics';
import { base64Url, decodeJwt } from './tokens.fixtures';

/** \{"alg":"HS256","typ":"JWT"\} . \{"sub":"123","name":"山田","iat":1700000000,"exp":1700003600\} */
const header = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
const payload = base64Url('{"sub":"123","name":"山田","iat":1700000000,"exp":1700003600}');
const token = `${header}.${payload}.signature`;

/** 任意のペイロード（JSON の文字列）を持つトークン */
const tokenWith = (json: string) => `${header}.${base64Url(json)}.signature`;

describe('JWTの表示用Base64', () => {
  it('正常なパディングは表示用に許容し、不正な個数は補正しない', () => {
    const body = base64Url('{"a":1}');
    const padded = body + '='.repeat((4 - body.length % 4) % 4);
    expect(parseJwt(`${header}.${padded}.signature`).payload).toEqual({ a: 1 });
    expect(() => parseJwt(`${header}.${padded}=.signature`)).toThrow('ペイロードをデコードできません');
  });
});

describe('整形結果の大きさ', () => {
  it('深い入れ子で整形結果が膨らむペイロードは、整形せずに元のテキストで表示し、警告する', () => {
    /** 200段の配列の中に10万個の 0（約20万単位）。整形すると、インデントで約4,000万単位になる */
    const json = `{"sub":9007199254740993,"x":${'['.repeat(200)}${Array(100_000).fill('0').join(',')}${']'.repeat(200)}}`;
    const long = tokenWith(json);
    const started = performance.now();
    const r = decodeJwt(long, 0);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(r.payloadJson).toBe(json);
    expect(r.warnings).toContain('ペイロード：整形すると大きくなりすぎるため、デコードしたテキストをそのまま表示しています');
    /** 構文木は読めているので、クレームは元の表記のまま表示する */
    expect(r.claims.find((c) => c.name === 'sub')?.value).toBe('9007199254740993');
  });
});

describe('クレームと時刻の元の表記', () => {
  it('クレームの表と時刻の欄は、大きな整数や小数の桁を変えずに表示する', () => {
    const r = decodeJwt(tokenWith('{"sub":9007199254740993,"aud":["a","b"],"jti":{"n":1.10},"exp":1700000000.10}'), 0);
    expect(Object.fromEntries(r.claims.map((c) => [c.name, c.value]))).toEqual({ sub: '9007199254740993', aud: 'a, b', jti: '{"n":1.10}' });
    expect(r.timeClaims.find((c) => c.name === 'exp')).toMatchObject({ epoch: 1700000000.1, epochText: '1700000000.10' });
  });

  it('同じキーが2回あれば、判定と同じく後の値を表示する', () => {
    const r = decodeJwt(tokenWith('{"sub":"first","sub":"second"}'), 0);
    expect(r.claims).toEqual([expect.objectContaining({ name: 'sub', value: 'second' })]);
  });

  it('整形できないペイロードでは、文字列以外のクレームを表記の変わる値で表示しない', () => {
    const r = decodeJwt(tokenWith(`{"sub":9007199254740993,"iss":"x","deep":${'['.repeat(1001)}${']'.repeat(1001)}}`), 0);
    expect(r.claims.find((c) => c.name === 'iss')?.value).toBe('x');
    expect(r.claims.find((c) => c.name === 'sub')?.value).not.toContain('9007199254740992');
  });

  it('解析（parseJwt）は現在時刻に依存せず、判定（judgeJwt）だけを時刻ごとにやり直せる', () => {
    const parsed = parseJwt(token);
    expect(judgeJwt(parsed, 1700003599_000)).toMatchObject({ expired: false, headerJson: parsed.headerJson });
    expect(judgeJwt(parsed, 1700003600_000).expired).toBe(true);
    expect(judgeJwt(parsed, 0)).toEqual(decodeJwt(token, 0));
  });
});

describe('decodeJwt', () => {
  it('整形できない深い入れ子でも、大きな整数を変えずに元のテキストで表示し、警告する', () => {
    const json = `{"id":9007199254740993,"deep":${'['.repeat(1001)}${']'.repeat(1001)}}`;
    const r = decodeJwt(tokenWith(json), 0);
    expect(r.payloadJson).toBe(json);
    expect(r.warnings.some((w) => w.startsWith('ペイロード：整形できないため、デコードしたテキストをそのまま表示しています'))).toBe(true);
  });

  it('ヘッダとペイロードをデコードする', () => {
    const r = decodeJwt(token, 0);
    expect(r.header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(r.payload.name).toBe('山田');
    expect(r.signature).toBe('signature');
  });

  it('時刻クレームをJSTに変換する', () => {
    const r = decodeJwt(token, 0);
    const iat = r.timeClaims.find((c) => c.name === 'iat');
    expect(iat?.jst).toBe('2023-11-15 07:13:20');
  });

  it('有効期限を判定する', () => {
    expect(decodeJwt(token, 1700003599_000).expired).toBe(false);
    expect(decodeJwt(token, 1700003600_000).expired).toBe(true);
  });

  it('有効開始（nbf）より前かを判定する', () => {
    const t = tokenWith('{"nbf":1700000000,"exp":1700003600}');
    expect(decodeJwt(t, 1699999999_000).notYetValid).toBe(true);
    expect(decodeJwt(t, 1700000000_000).notYetValid).toBe(false);
    expect(decodeJwt(token, 0).notYetValid).toBe(null);
  });

  it('数値でない時刻クレームは「なし」と区別し、型が不正だと警告する', () => {
    const r = decodeJwt(tokenWith('{"exp":"0","nbf":"4102444800","iat":null}'), 0);
    expect(r.expired).toBe('invalid');
    expect(r.notYetValid).toBe('invalid');
    expect(r.timeClaims).toEqual([]);
    expect(r.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('exp が 数値ではありません（"0"）'),
      expect.stringContaining('nbf が 数値ではありません（"4102444800"）'),
      expect.stringContaining('iat が 数値ではありません（null）'),
    ]));
  });

  it('Infinity になる巨大な exp を「有効期限内」としない', () => {
    const r = decodeJwt(tokenWith('{"exp":1e999}'), 0);
    expect(r.expired).toBe('invalid');
    expect(r.warnings.join()).toContain('exp が 有限の数ではありません');
    expect(r.timeClaims).toEqual([]);
  });

  it('Bearer接頭辞を許容する', () => {
    expect(decodeJwt(`Bearer ${token}`, 0).header.alg).toBe('HS256');
  });

  it('表示用の JSON では、大きな整数や小数の表記を変えない', () => {
    const r = decodeJwt(tokenWith('{"sub":12345678901234567890,"amount":1.10}'), 0);
    expect(r.payloadJson).toBe('{\n  "sub": 12345678901234567890,\n  "amount": 1.10\n}');
    expect(r.headerJson).toBe('{\n  "alg": "HS256",\n  "typ": "JWT"\n}');
  });

  it('重複したキーは消さずに警告する', () => {
    const r = decodeJwt(tokenWith('{"role":"user","role":"admin"}'), 0);
    expect(r.payloadJson).toBe('{\n  "role": "user",\n  "role": "admin"\n}');
    expect(r.warnings).toEqual(['ペイロード：キー「role」が重複しています（1行目）']);
  });

  it('1888年より前の時刻クレームは、JST ではなくオフセット（+09:18:59）を付ける', () => {
    /** iat が -3000000000（1874年）。東京の当時のずれは +09:18:59 で、「JST」（+09:00）と書くと貼り戻したときにずれる */
    const r = decodeJwt(tokenWith('{"iat":-3000000000,"exp":1700000000}'), 0);
    expect(r.timeClaims.map(({ name, jst, zone }) => ({ name, jst, zone }))).toEqual([
      { name: 'iat', jst: '1874-12-08 03:58:59', zone: '+09:18:59' },
      { name: 'exp', jst: '2023-11-15 07:13:20', zone: 'JST' },
    ]);
  });

  it('日時にできない時刻クレームがあっても、ほかの部分はデコードする', () => {
    const r = decodeJwt(tokenWith('{"sub":"1","exp":9999999999999}'), 0);
    expect(r.timeClaims).toEqual([{ name: 'exp', label: '有効期限 (exp)', epoch: 9999999999999, epochText: '9999999999999', jst: null, zone: null, relative: null }]);
    expect(r.payload.sub).toBe('1');
    expect(r.expired).toBe(false);
    /** Infinity になる値は NumericDate として使えないため、不正とする（ほかの部分はデコードする） */
    const infinite = decodeJwt(tokenWith('{"sub":"1","exp":1e400}'), 0);
    expect(infinite.payload.sub).toBe('1');
    expect(infinite.expired).toBe('invalid');
  });

  it('形式が不正ならエラー', () => {
    expect(() => decodeJwt('abc.def')).toThrow();
    expect(() => decodeJwt('abc.def.ghi')).toThrow();
  });

  it('時刻クレームに、現在からの差を付ける', () => {
    const r = decodeJwt(token, 1700000000_000);
    expect(r.timeClaims.find((c) => c.name === 'exp')?.relative).toBe('1時間後');
    expect(r.timeClaims.find((c) => c.name === 'iat')?.relative).toBe('現在');
  });

  it('署名の対象は「ヘッダ.ペイロード」（Bearer を除く）', () => {
    expect(decodeJwt(`Bearer ${token}`, 0).signingInput).toBe(`${header}.${payload}`);
  });

  it('5つに分かれたトークンは JWE として案内する', () => {
    expect(() => decodeJwt('a.b.c.d.e')).toThrow('JWE（暗号化されたトークン）です');
  });
});

describe('時刻クレームの表記', () => {
  it('auth_time を日時で表示し、説明の表には重ねて出さない', () => {
    const r = decodeJwt(tokenWith('{"auth_time":1700000000}'), 0);
    expect(r.timeClaims).toMatchObject([{ name: 'auth_time', label: '認証日時 (auth_time)', jst: '2023-11-15 07:13:20' }]);
    expect(r.claims).toEqual([]);
  });

  it.each(['exp', 'iat', 'nbf', 'auth_time'])('%s がミリ秒で書かれていれば警告する', (name) => {
    const r = decodeJwt(tokenWith(`{"${name}":1700000000000}`), 0);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain(`${name}（1700000000000）はミリ秒`);
    expect(r.warnings[0]).toContain('2023-11-15 07:13:20 JST');
  });

  it('小数の桁が長い時刻は、警告には抜粋を入れ、表の元の表記は全文を持つ', () => {
    const raw = `1700000000000.${'0'.repeat(10_000)}`;
    const r = decodeJwt(tokenWith(`{"exp":${raw}}`), 0);
    expect(r.timeClaims[0]?.epochText).toBe(raw);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain(`exp（${raw.slice(0, 255)}…）はミリ秒`);
    expect(r.warnings[0]?.length).toBeLessThan(500);
  });

  it('秒の値と、ミリ秒としても読めない値は警告しない', () => {
    expect(decodeJwt(tokenWith('{"exp":1700000000}'), 0).warnings).toEqual([]);
    expect(decodeJwt(tokenWith('{"exp":999999999999}'), 0).warnings).toEqual([]);
    expect(decodeJwt(tokenWith('{"exp":1e300}'), 0).warnings).toEqual([]);
  });
});

describe('claimRows', () => {
  it('意味の決まっているクレームに説明を付ける（配列は「, 」でつなぐ）', () => {
    expect(claimRows({ iss: 'https://auth.example.com', aud: ['api', 'web'], name: '山田', scope: 'read write' })).toEqual([
      { name: 'iss', label: '発行者（このトークンを発行したサーバー）', value: 'https://auth.example.com' },
      { name: 'aud', label: '受信者（このトークンを受け付けてよいサービス）', value: 'api, web' },
      { name: 'scope', label: '許可された操作の範囲（スコープ）', value: 'read write' },
    ]);
    expect(claimRows({ sub: 123 })[0]?.value).toBe('123');
  });
});

describe('UTF-8 として不正な値', () => {
  it('置換文字にせず、デコードできないと伝える', () => {
    const utf8 = (text: string) => [...new TextEncoder().encode(text)];
    const bad = base64Url(new Uint8Array([...utf8('{"sub":"'), 0xff, 0xfe, ...utf8('"}')]));
    expect(() => decodeJwt(`${header}.${bad}.AA`)).toThrow('ペイロードをデコードできません');
    expect(() => decodeJwt(`${bad}.${bad}.AA`)).toThrow('ヘッダをデコードできません');
  });
});

describe('長い crit の名前', () => {
  it('crit の名前は件数を10件に絞り、1件ずつ抜粋にする', () => {
    const long = 'c'.repeat(1_000_000);
    const warning = headerWarnings({ alg: 'HS256', crit: [long, 'exp', ...Array(20).fill(long)] }).find((w) => w.message.startsWith('crit（'))!.message;
    expect(warning.startsWith(`crit（${'c'.repeat(255)}…, exp, `)).toBe(true);
    expect(warning).toContain('ほか12件');
    expect(warning.length).toBeLessThan(10 * 256 + 200);
  });
});

describe('警告を組み立てられない値', () => {
  it('文字列にできない crit の要素でも、デコードの結果を表示し、型を示して警告する', () => {
    const r = decodeJwt(`${base64Url('{"alg":"HS256","crit":[{"toString":0,"valueOf":0},"exp",[1,2]]}')}.${base64Url('{"sub":"1"}')}.s`, 0);
    expect(r.payload.sub).toBe('1');
    expect(r.headerWarnings.some((w) => w.message.startsWith('crit（オブジェクト, exp, 配列（要素2個））があります'))).toBe(true);
  });

  it('深い入れ子の exp でも、デコードの結果を表示し、型だけを示して警告する', () => {
    /** 2万段の配列（JSON.stringify は RangeError になる。整形も深さの上限で行わない） */
    const payload = base64Url(`{"sub":"1","exp":${'['.repeat(20_000)}${']'.repeat(20_000)}}`);
    const r = decodeJwt(`${base64Url('{"alg":"HS256"}')}.${payload}.s`, 0);
    expect(r.payload.sub).toBe('1');
    expect(r.expired).toBe('invalid');
    expect(r.warnings.some((w) => w.startsWith('exp が 数値ではありません（配列（要素1個））'))).toBe(true);
  });

  it('長い文字列の値は、先頭だけを示す', () => {
    const r = decodeJwt(`${base64Url('{"alg":"HS256","b64":"' + 'あ'.repeat(100) + '"}')}.${base64Url('{}')}.s`, 0);
    expect(r.headerWarnings.find((w) => w.message.startsWith('b64 が'))?.message).toContain(`"${'あ'.repeat(40)}…"`);
  });
});

describe('headerWarnings', () => {
  it('alg: none（大文字小文字を問わない）を警告する', () => {
    expect(headerWarnings({ alg: 'nOnE' })[0]).toMatchObject({ tone: 'bad', message: expect.stringContaining('alg が none') });
  });

  it('外部の鍵の URL、埋め込まれた鍵、crit を警告する', () => {
    const w = headerWarnings({ alg: 'RS256', jku: 'https://example.com/keys', jwk: {}, crit: ['exp'] });
    expect(w).toHaveLength(3);
    /** 重大（bad）は alg: none だけ。ほかの指定は警告（warn）にする */
    expect(w.map((x) => x.tone)).toEqual(['warn', 'warn', 'warn']);
    expect(w[0]?.message).toContain('jku（鍵を取得する URL）');
    expect(w[1]?.message).toContain('鍵（jwk）が埋め込まれています');
    expect(w[2]?.message).toContain('crit（exp）');
  });

  it('配列でない crit も警告する', () => {
    expect(headerWarnings({ alg: 'HS256', crit: 'exp' })[0]?.message).toContain('crit（"exp"）');
  });

  it('普通のヘッダでは警告しない', () => {
    expect(headerWarnings({ alg: 'HS256', typ: 'JWT', kid: 'k1' })).toEqual([]);
  });
});

describe('decodeJwe', () => {
  it('JWE のヘッダだけを読む', () => {
    const h = base64Url('{"alg":"RSA-OAEP","enc":"A256GCM"}');
    expect(decodeJwe(`${h}.key.iv.cipher.tag`)?.header).toEqual({ alg: 'RSA-OAEP', enc: 'A256GCM' });
    expect(decodeJwe(token)).toBeNull();
  });
});

describe('b64（RFC 7797）', () => {
  it('b64 が true 以外なら、表示したペイロードが標準の読み方であることを伝える', () => {
    expect(headerWarnings({ alg: 'HS256', b64: false }).map((w) => w.message).join()).toContain('b64 が false です');
    expect(headerWarnings({ alg: 'HS256', b64: 'no' }).map((w) => w.message).join()).toContain('b64 が "no" です');
    expect(headerWarnings({ alg: 'HS256', b64: true }).map((w) => w.message).join()).not.toContain('b64');
  });
});
