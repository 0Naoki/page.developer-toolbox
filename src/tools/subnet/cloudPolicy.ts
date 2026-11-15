/**
 * 標準的なクラウドの予約アドレス計算と、作成可能なサブネットサイズの案内を分ける。
 *
 * @remarks
 * IPv4・IPv6 の計算は同じ予約数（{@link CLOUD_RESERVED}）を使う。サイズの案内は別の純粋関数で組み立て、
 * サービス固有の条件（作成できるサイズなど）がアドレス範囲の計算を止めることはない。
 */
export const CLOUD_RESERVED = 5;

/** 予約数の計算はこの方式を選んだ場合の概算。BYOIP などの例外は USAGE に記載する。 */
const RESERVED_NOTE = 'AWS・Azure の標準的な予約（先頭4つと末尾1つ）を除いています';

/** 公式資料の確認日。変更時は USAGE の参照先と検証表も更新する。 */
export const CLOUD_POLICY_CHECKED_AT = '2026-11-12';

export const CLOUD_POLICIES = [
  {
    name: 'AWS',
    ipv4: { min: 16, max: 28, step: 1 }, ipv6: { min: 44, max: 64, step: 4 },
    source: 'https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html',
  },
  {
    name: 'Azure',
    ipv4: { min: 2, max: 29, step: 1 }, ipv6: { min: 64, max: 64, step: 1 },
    source: 'https://learn.microsoft.com/en-us/azure/virtual-network/virtual-networks-faq',
  },
] as const;

/** 予約数の計算を止めず、各サービスのサイズ条件を別の案内として返す。作成可否全体の検証は行わない。 */
export function cloudSubnetNotes(family: 4 | 6, prefix: number): string[] {
  return [RESERVED_NOTE, ...CLOUD_POLICIES.map((policy) => {
    const rule = family === 4 ? policy.ipv4 : policy.ipv6;
    const range = rule.min === rule.max ? `/${rule.min}` : `/${rule.min}〜/${rule.max}`;
    const step = rule.step === 1 ? '' : `（${rule.step}刻み）`;
    const supported = Number.isInteger(prefix) && prefix >= rule.min && prefix <= rule.max && (prefix - rule.min) % rule.step === 0;
    return `${policy.name} の IPv${family} サブネットは ${range}${step} です${supported ? '' : `（/${prefix} は対象外）`}`;
  })];
}
