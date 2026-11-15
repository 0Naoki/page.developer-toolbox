import { ClippedText } from './ClippedText';
import { CopyButton } from './CopyButton';

/**
 * 項目名と値の表（`.kv`）の1行。値は等幅（mono）で、右の列にコピーボタンを置く。
 *
 * @remarks
 * 値は ClippedText で上限までに切り詰める（長い値でも表が崩れず、全文はコピーで取り出せる）。
 * 右の列にコピーボタンがある行は、省略したときの「全文をコピー」を重ねて出さない。
 * コピーしない行も右の列（空のセル）を置き、ほかの行と列の数をそろえる。
 *
 * @param copy - 右の列にコピーボタンを置くか。計算中・「なし」など、コピーしても意味のない値では false にする。
 * @param mono - 値を等幅で表示するか。曜日などの文章は false にする。
 */
export function KvRow({ label, value, copy = true, mono = true }: { label: string; value: string; copy?: boolean; mono?: boolean }) {
  return (
    <tr>
      <th>{label}</th>
      <td className={mono ? 'mono' : undefined}>
        <ClippedText text={value} copy={!copy} />
      </td>
      <td className="right">{copy && <CopyButton text={value} />}</td>
    </tr>
  );
}
