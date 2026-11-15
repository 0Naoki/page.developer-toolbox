import { useEffect, useState } from 'react';
import { clearAllData } from '../lib/storage';

/** 入力内容の保存についての説明と、保存データの全消去 */
export function PrivacySettings() {
  const [confirming, setConfirming] = useState(false);

  /** 確認状態は数秒で元に戻す */
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  const clear = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    clearAllData();
  };

  return (
    <div className="privacy">
      <p className="privacy-note">
        入力内容はこのタブの中だけに保持し、タブを閉じると消えます。ブラウザを閉じた後まで残す保存はしません。外部には送信されません。
      </p>
      <button type="button" className={confirming ? 'link-btn danger' : 'link-btn'} onClick={clear}>
        {confirming ? 'もう一度押すと消去します' : '保存データをすべて消去'}
      </button>
      <p className="privacy-note">全消去すると、開いている本ツールの別タブも再読み込みし、入力と編集履歴を破棄します。</p>
    </div>
  );
}
