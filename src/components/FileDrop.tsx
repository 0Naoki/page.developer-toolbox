import { useState, type ReactNode } from 'react';

/**
 * ファイルをドロップ、またはクリックして選ぶ欄。
 * 中のファイル入力は見えないため、キーボードで選んだときは枠を表示する（src/styles/file-drop.css の .dropzone）。
 * 同じファイルを選び直しても onFile が呼ばれるよう、選んだあとに入力を空に戻す
 */
export function FileDrop({
  onFile,
  accept,
  small = false,
  children,
}: {
  onFile: (file: File | undefined) => void;
  accept?: string;
  small?: boolean;
  children: ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  const className = ['dropzone', small && 'dropzone-small', dragging && 'over'].filter(Boolean).join(' ');
  return (
    <label
      className={className}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onFile(e.dataTransfer.files[0]);
      }}
    >
      <input
        type="file"
        className="visually-hidden"
        accept={accept}
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {children}
    </label>
  );
}
