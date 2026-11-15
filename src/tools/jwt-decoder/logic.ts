import { base64ToBytes } from '../../lib/bytes';
import { parseJsonSource, serializeJsonTree, stringifyNode, type JsonNode } from '../../lib/jsonTree';
import { MAX_DATE_MS } from '../../lib/time/timezone';
import { formatJst, relativeFrom } from '../../lib/time/dateTimeFormat';
import { TIME_CLAIMS, headerWarnings, isNumericDate, millisWarning, timeClaimTypeWarnings, type HeaderWarning } from './diagnostics';
import { errorMessage } from '../../lib/errors';

export type TimeClaim = {
  name: 'exp' | 'iat' | 'nbf' | 'auth_time';
  label: string;
  epoch: number;
  /** 書かれたとおりの数値の表記（「1700000000.10」など） */
  epochText: string;
  /** 日時として表せない値（ミリ秒で書かれた巨大な値など）は null */
  jst: string | null;
  /** 現在からの差（「3時間後」など） */
  relative: string | null;
};

export type ClaimRow = { name: string; label: string; value: string };

export type DecodedJwt = {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  /** 表示用の整形済み JSON。数値や文字列は元の表記のまま */
  headerJson: string;
  payloadJson: string;
  /** 重複したキーなど */
  warnings: string[];
  signature: string;
  /** 署名の対象（「ヘッダ.ペイロード」の Base64URL のまま） */
  signingInput: string;
  /** ヘッダの危険な指定（alg: none、外部の鍵の URL など） */
  headerWarnings: HeaderWarning[];
  /** 意味の決まっているクレーム（iss・sub・aud など）の説明 */
  claims: ClaimRow[];
  timeClaims: TimeClaim[];
  /** exp がない場合は null。数値（有限の数）でない場合は 'invalid' */
  expired: boolean | 'invalid' | null;
  /** nbf（有効開始）がまだ来ていない。nbf がない場合は null。数値（有限の数）でない場合は 'invalid' */
  notYetValid: boolean | 'invalid' | null;
};

const LABELS: Record<TimeClaim['name'], string> = {
  exp: '有効期限 (exp)',
  iat: '発行日時 (iat)',
  nbf: '有効開始 (nbf)',
  auth_time: '認証日時 (auth_time)',
};

/** 不正なバイトを置換文字（U+FFFD）にすると、元と違う内容を正常な値のように表示してしまう */
const base64UrlToText = (part: string): string => new TextDecoder('utf-8', { fatal: true }).decode(base64ToBytes(part));

/** entries は、元の表記を保つ一番外側のキーと値（同じキーは JSON.parse と同じく後のものを使う）。整形できなければ null */
type Part = { value: Record<string, unknown>; json: string; warnings: string[]; entries: ReadonlyMap<string, JsonNode> | null };

function parsePart(part: string, name: string): Part {
  let text: string;
  let value: unknown;
  try {
    text = base64UrlToText(part);
    value = JSON.parse(text);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  } catch {
    throw new Error(`${name}をデコードできません`);
  }
  /**
   * JSON.stringify で表示すると、大きな整数（64ビットのID）や「1.10」の表記が変わり、重複したキーも消えるため、
   * 表示には表記を保つ JSON 整形を使う。exp などの判定には JSON.parse した値を使う
   */
  const record = value as Record<string, unknown>;
  const warnings: string[] = [];
  let root: JsonNode;
  try {
    root = parseJsonSource(text, warnings);
  } catch (e) {
    /** 整形できない場合（入れ子が深すぎるなど）に JSON.stringify へ切り替えると、大きな整数などが黙って変わるため、元のテキストのまま表示する */
    return { value: record, json: text, warnings: [`${name}：整形できないため、デコードしたテキストをそのまま表示しています（${errorMessage(e)}）`], entries: null };
  }
  const entries = new Map<string, JsonNode>();
  if (root.kind === 'object') for (const entry of root.entries) entries.set(entry.name, entry.value);
  const prefixed = warnings.map((w) => `${name}：${w}`);
  let json: string;
  try {
    json = serializeJsonTree(root, '  ', false, 0, MAX_FORMATTED);
  } catch {
    /** 深い入れ子ではインデントで出力が大きく膨らみ、画面の処理で整形すると止まるため、上限を超えたら元のテキストのまま表示する */
    return { value: record, json: text, warnings: [...prefixed, `${name}：整形すると大きくなりすぎるため、デコードしたテキストをそのまま表示しています`], entries };
  }
  return { value: record, json, warnings: prefixed, entries };
}

/**
 * 整形結果の上限（UTF-16 の単位）。JWT の解析は画面の処理で同期に行うため、JSON整形ツール（Worker で計算）より小さくする。
 * 超えたときは元のテキストを表示するので、内容は失われない
 */
const MAX_FORMATTED = 2_000_000;

const partsOf = (token: string) => token.trim().replace(/^Bearer\s+/i, '').split('.');

/** 意味の決まっているクレーム（RFC 7519 4.1 と、OpenID Connect などでよく使うもの） */
const CLAIM_LABELS: Record<string, string> = {
  iss: '発行者（このトークンを発行したサーバー）',
  sub: '主体（ユーザーなど、このトークンが表す相手）',
  aud: '受信者（このトークンを受け付けてよいサービス）',
  jti: 'トークンの ID（使い回しの検出に使う）',
  azp: '発行を求めたクライアント',
  client_id: 'クライアント ID',
  scope: '許可された操作の範囲（スコープ）',
  nonce: 'リプレイ対策の値（認証の要求と応答を結び付ける）',
  sid: 'セッション ID',
  amr: '認証の方法',
  acr: '認証の強さ',
};

const isStrings = (v: unknown): v is string | string[] => typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
const show = (v: unknown): string => (isStrings(v) ? (typeof v === 'string' ? v : v.join(', ')) : JSON.stringify(v));
/** 文字列の値か（数値・true などの値と区別する） */
const isStringNode = (n: JsonNode): boolean => n.kind === 'scalar' && n.raw.startsWith('"');

/** 元の表記を保つ値の表示。文字列はそのまま、文字列の配列は「, 」でつなぎ、ほかは書かれたとおりの JSON にする */
function showNode(node: JsonNode): string {
  if (node.kind === 'scalar') return isStringNode(node) ? JSON.parse(node.raw) as string : node.raw;
  if (node.kind === 'array' && node.items.every(isStringNode)) return node.items.map((x) => JSON.parse((x as { raw: string }).raw) as string).join(', ');
  return stringifyNode(node);
}

/** 整形できなかったペイロードで、文字列以外の値を JSON.parse の値で表示すると表記が変わるため、表示しない */
const NOT_SHOWN = '（ペイロードを整形できないため省略しています。上のペイロードを見てください）';

/**
 * ペイロードのうち、意味の決まっているクレームの説明。
 *
 * @param entries - 元の表記を保つ一番外側のキーと値。null はペイロードを整形できなかったことを表し、
 *   文字列以外の値は表示しない。省略すると payload の値（JSON.parse の結果）で表示する。
 */
export function claimRows(payload: Record<string, unknown>, entries?: ReadonlyMap<string, JsonNode> | null): ClaimRow[] {
  return Object.entries(CLAIM_LABELS)
    .filter(([k]) => k in payload)
    .map(([k, label]) => {
      const node = entries?.get(k);
      const value = node ? showNode(node) : entries === null && !isStrings(payload[k]) ? NOT_SHOWN : show(payload[k]);
      return { name: k, label, value };
    });
}

export type DecodedJwe = { header: Record<string, unknown>; headerJson: string };

/** JWE（「ヘッダ.暗号化した鍵.IV.暗号文.認証タグ」の5つ）なら、ヘッダだけを読む。JWE でなければ null */
export function decodeJwe(token: string): DecodedJwe | null {
  const parts = partsOf(token);
  const [head] = parts;
  if (parts.length !== 5 || head === undefined) return null;
  const header = parsePart(head, 'ヘッダ');
  return { header: header.value, headerJson: header.json };
}

/** 現在時刻に依存しない時刻クレーム。ms は日時に変換できない値なら null */
export type ParsedTimeClaim = Omit<TimeClaim, 'relative'> & { ms: number | null };

/** 現在時刻に依存しない解析結果。トークンが変わったときだけ作り直す */
export type ParsedJwt = Omit<DecodedJwt, 'timeClaims' | 'expired' | 'notYetValid'> & { timeClaims: ParsedTimeClaim[] };

/**
 * JWT のヘッダとペイロードを読み、表示用の JSON・クレーム・警告をまとめる。
 *
 * @remarks
 * JSON の表示とクレームの表示は、数値・文字列の元の表記を保つ。期限などの判定には JSON.parse した値を使う。
 * 署名は検証しない（`verify.ts` の担当）。現在時刻に依存する判定は {@link judgeJwt} で行う。
 *
 * @param token - 3部分からなる JWT（JWS）の文字列。
 * @throws トークンの部分数、UTF-8、JSON オブジェクトの形式が不正な場合。
 */
export function parseJwt(token: string): ParsedJwt {
  const parts = partsOf(token);
  if (parts.length === 5) throw new Error('JWE（暗号化されたトークン）です。中身の表示には復号の鍵が必要です');
  const [head, body, signature] = parts;
  if (parts.length !== 3 || head === undefined || body === undefined || signature === undefined) throw new Error('JWTは「ヘッダ.ペイロード.署名」の3つに分かれている必要があります');

  const header = parsePart(head, 'ヘッダ');
  const payload = parsePart(body, 'ペイロード');

  const timeClaims: ParsedTimeClaim[] = TIME_CLAIMS
    .filter((k) => isNumericDate(payload.value[k]))
    .map((k) => {
      const epoch = payload.value[k] as number;
      const node = payload.entries?.get(k);
      const epochText = node?.kind === 'scalar' ? node.raw : String(epoch);
      const ms = epoch * 1000;
      /** 範囲外の値で日時の書式が例外を投げると、ほかの部分も表示できなくなるため、この項目だけ日時を出さない */
      if (!Number.isFinite(ms) || Math.abs(ms) > MAX_DATE_MS) return { name: k, label: LABELS[k], epoch, epochText, jst: null, ms: null };
      return { name: k, label: LABELS[k], epoch, epochText, jst: formatJst(new Date(ms)), ms };
    });

  return {
    header: header.value,
    payload: payload.value,
    headerJson: header.json,
    payloadJson: payload.json,
    warnings: [...header.warnings, ...payload.warnings, ...timeClaimTypeWarnings(payload.value), ...timeClaims.flatMap((c) => millisWarning(c.name, c.epoch, c.epochText) ?? [])],
    signature,
    signingInput: `${head}.${body}`,
    headerWarnings: headerWarnings(header.value),
    claims: claimRows(payload.value, payload.entries),
    timeClaims,
  };
}

/**
 * 解析済みの JWT に、現在時刻での判定（期限切れ・有効開始前・相対時刻）を加える。
 *
 * @remarks
 * 期限がない状態と、期限の値が不正な状態を区別する。毎秒呼んでも、トークンの解析はやり直さない。
 *
 * @param now - 時刻判定の基準となるミリ秒単位の UNIX 時刻。
 */
export function judgeJwt(parsed: ParsedJwt, now: number): DecodedJwt {
  /** 数値でない値を「なし」と同じに扱うと、期限のないトークンに見えるため、不正として区別する */
  const judge = (k: 'exp' | 'nbf', test: (ms: number) => boolean): boolean | 'invalid' | null => {
    const value = parsed.payload[k];
    if (value === undefined) return null;
    return isNumericDate(value) ? test(value * 1000) : 'invalid';
  };
  return {
    ...parsed,
    timeClaims: parsed.timeClaims.map(({ ms, ...c }) => ({ ...c, relative: ms === null ? null : relativeFrom(new Date(ms), now) })),
    expired: judge('exp', (ms) => ms <= now),
    /** RFC 7519 4.1.5：nbf より前は受け付けてはならない（nbf ちょうどからは有効） */
    notYetValid: judge('nbf', (ms) => ms > now),
  };
}
