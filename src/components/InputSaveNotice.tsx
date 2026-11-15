import { useSyncExternalStore } from 'react';
import { getInputSaveFailures, subscribeInputSaveFailures } from '../lib/storage';
import { downloadText } from '../lib/file';
import { CopyButton } from './CopyButton';
import { ErrorBox } from './ErrorMessage';

/** 保存容量超過などで残せなかった入力を、画面移動前に退避できるようにする。 */
export function InputSaveNotice() {
  const failures = useSyncExternalStore(subscribeInputSaveFailures, getInputSaveFailures, getInputSaveFailures);
  if (failures.length === 0) return null;
  return <ErrorBox alert title="入力の変更をブラウザに保存できませんでした。この画面に未保存の入力があります。">
    <p>再読み込み・画面移動・タブを閉じる前に、入力をコピーするかファイルに保存してください。再読み込みすると以前の保存内容に戻る場合があります。</p>
    {failures.map((failure, index) => {
      const label = failures.length === 1 ? '未保存の入力' : `未保存の入力${index + 1}`;
      return <div className="toolbar" key={index}>
        <CopyButton text={failure.read()} label={`${label}をコピー`} />
        <button type="button" className="btn btn-ghost" onClick={() => downloadText(`unsaved-input-${index + 1}.txt`, failure.read(), 'text/plain')}>{label}を保存</button>
      </div>;
    })}
    <button type="button" className="btn btn-ghost" onClick={() => failures.forEach((failure) => failure.retry())}>保存を再試行</button>
  </ErrorBox>;
}
