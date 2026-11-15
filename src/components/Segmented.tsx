type Option<T> = { value: T; label: string };

/** ボタンを横に並べた択一の切り替え。選択中のボタンは aria-pressed で読み上げソフトに伝える */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className={o.value === value ? 'seg active' : 'seg'}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
