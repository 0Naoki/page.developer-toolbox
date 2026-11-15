import { useMemo } from 'react';
import { useCalculation } from '../../hooks/useCalculation';
import { convertFile, effectiveOptions, type ConversionSettings, type InputFile } from './conversion';
import { convertText, SYNC_LIMIT, type TextConversion } from './logic';

/** 短い入力・ファイル入力では同じ空の要求を使い、編集のたびに Worker を起動しない。 */
const IDLE_REQUEST = { tool: 'base64', input: '', direction: 'encode', mode: 'base64', wrap: false } as const;

/** 同期変換と Worker 変換を選び、現在の入力に対する結果だけを返す。ファイルは MAX_FILE 以下を読み込んだものを受け取る。 */
export function useBase64Conversion(input: string, file: InputFile | null, settings: ConversionSettings) {
  const { fromFile, dataUri, wrapped } = effectiveOptions(settings);
  const { direction, mode } = settings;
  const large = !fromFile && input.length > SYNC_LIMIT;
  const request = useMemo(() => ({ tool: 'base64' as const, input, direction, mode, wrap: wrapped }), [input, direction, mode, wrapped]);
  const calculation = useCalculation(large ? request : IDLE_REQUEST);
  const result = useMemo((): TextConversion => {
    if (fromFile) return convertFile(file, mode, dataUri, wrapped);
    if (large) return calculation.result ?? { kind: 'empty' };
    return convertText({ input, direction, mode, wrap: wrapped });
  }, [fromFile, file, mode, dataUri, wrapped, large, calculation.result, input, direction]);
  return { fromFile, dataUri, large, calculation, result };
}
