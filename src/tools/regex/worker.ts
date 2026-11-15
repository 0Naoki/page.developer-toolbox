import { evaluateRegex, type RegexInput } from './logic';

/** Worker 専用。利用者の入力はスクリプトとして実行せず、RegExp の引数としてだけ扱う。 */
self.onmessage = (event: MessageEvent<RegexInput>) => {
  self.postMessage(evaluateRegex(event.data));
};
