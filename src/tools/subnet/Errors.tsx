import type { ListError } from './ranges';

import { MAX_MESSAGES } from './listCalculation';
import { ErrorText } from '../../components/ErrorMessage';
import { previewList } from '../../lib/listPreview';
import { formatNumber } from '../../lib/number';

export function Errors({ errors, total = errors.length }: { errors: ListError[]; total?: number }) {
  /** Worker からは先頭だけが届き、total に全件の数が入る */
  const { shown, rest } = previewList(errors, MAX_MESSAGES, total);
  return (
    <>
      {shown.map((e) => (
        <ErrorText key={`${e.line}:${e.message}`} message={`${e.line}行目：${e.message}`} />
      ))}
      {rest > 0 && <ErrorText message={`ほか ${formatNumber(rest)} 行にエラーがあります`} />}
    </>
  );
}
