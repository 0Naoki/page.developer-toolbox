import {
  type Width,
} from './logic';

/** クリックで切り替えられるビットの表示 */

export function BitGrid({ unsigned, width, onToggle }: { unsigned: bigint; width: Exclude<Width, 0>; onToggle: (i: number) => void }) {
  const bytes = Array.from({ length: width / 8 }, (_, b) => width / 8 - 1 - b); /** 上位バイトから */
  return (
    <div className="bit-grid" role="group" aria-label="ビット（押すと 0 と 1 が切り替わります）">
      {bytes.map((byte) => (
        <div key={byte} className="bit-byte">
          <span className="bit-index" aria-hidden="true">
            {byte * 8 + 7}–{byte * 8}
          </span>
          <span className="bit-row">
            {Array.from({ length: 8 }, (_, k) => {
              const i = byte * 8 + 7 - k;
              const on = ((unsigned >> BigInt(i)) & 1n) === 1n;
              return (
                <button
                  key={i}
                  type="button"
                  className={on ? 'bit on' : 'bit'}
                  aria-pressed={on}
                  /** 表示している 0・1 を名前に含める（WCAG 2.5.3。表示の文字で音声操作できるように） */
                  aria-label={`ビット${i}：${on ? '1' : '0'}`}
                  onClick={() => onToggle(i)}
                >
                  {on ? '1' : '0'}
                </button>
              );
            })}
          </span>
        </div>
      ))}
    </div>
  );
}
