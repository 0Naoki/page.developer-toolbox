import { useState } from 'react';
import { useFileLoader } from '../../hooks/useFileLoader';
import { MAX_FILE } from './logic';
import type { InputFile } from './conversion';

/** 選んだファイルを保存せずに保持し、最後に選んだファイルだけを反映する。次の読込中は前の内容を消す。 */
export function useBase64File() {
  const [file, setFile] = useState<InputFile | null>(null);
  const loader = useFileLoader({
    limit: MAX_FILE,
    onStart: () => setFile(null),
    decode: (bytes, f): InputFile => ({ name: f.name, type: f.type, bytes }),
    onLoaded: setFile,
  });
  return { file, fileError: loader.error, fileLoading: loader.loading, pickFile: loader.pick };
}
