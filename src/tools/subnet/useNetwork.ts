import { useMemo } from 'react';
import { parseNetwork, subnetInfo, type ParsedNetwork, type SubnetInfo } from './ipv4';
import { isIpv6Text, parseNetwork6, subnetInfo6, type SubnetInfo6 } from './ipv6';
import { attempt, type Attempt } from '../../lib/errors';

type Parsed4 = { parsed: ParsedNetwork; info: SubnetInfo };
type Parsed6 = { parsed: ReturnType<typeof parseNetwork6>; info: SubnetInfo6 };

/**
 * 入力欄のネットワークを解析した結果。
 * `v6` は入力の書き方（{@link isIpv6Text}。先頭の値に `:` があるか）で決め、解析に失敗しても分かる（画面の切り替えに使うため）。
 * `result` は入力が空なら null。
 */
export type NetworkInput =
  | { v6: false; result: Attempt<Parsed4> | null }
  | { v6: true; result: Attempt<Parsed6> | null };

/**
 * 入力欄のネットワーク（IPv4 または IPv6）を解析し、サブネットの情報を求める。
 *
 * @remarks
 * IPv4 か IPv6 かの判定は、一覧のタブ（重複チェック・集約）と同じ {@link isIpv6Text} にそろえる
 * （名前やコメントに `:` があっても、先頭の値が IPv4 なら IPv4 として読む）。
 *
 * @param cloud - クラウドの予約アドレスを除いて数えるか。
 */
export function useNetwork(input: string, cloud: boolean): NetworkInput {
  return useMemo((): NetworkInput => {
    const v6 = isIpv6Text(input);
    const empty = !input.trim();
    if (v6) {
      return { v6, result: empty ? null : attempt(() => {
        const parsed = parseNetwork6(input);
        return { parsed, info: subnetInfo6(parsed.ip, parsed.prefix, cloud) };
      }) };
    }
    return { v6, result: empty ? null : attempt(() => {
      const parsed = parseNetwork(input);
      return { parsed, info: subnetInfo(parsed.ip, parsed.prefix, cloud) };
    }) };
  }, [input, cloud]);
}
