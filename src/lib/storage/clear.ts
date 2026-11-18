import { CLEAR_KEY, CLEAR_CHANNEL, TAB_GENERATION_KEY, safe, clearAppData, type StorageLike } from './io';
import { withStorageLock } from './lock';
import { createClearLifecycle, type ClearListener } from './clearState';
import { createClearOperations, type ClearState } from './clearOperations';

const lifecycle = createClearLifecycle();
const readClearGeneration = () => safe(() => localStorage.getItem(CLEAR_KEY), null);
const tabGeneration = readClearGeneration();

/**
 * 起動時に、このタブの sessionStorage の入力が、今の消去世代のときに保存したものかを確かめる。違えば入力を捨てる。
 *
 * @remarks
 * 全消去の通知は、そのときアプリを開いているタブにしか届かない。そのタブで別のサイトへ移動していた間に全消去すると、
 * 戻ったとき（またはセッションの復元で戻ったとき）に、消去前の入力が sessionStorage から復元されてしまうため、ここで捨てる。
 * - 記録した世代と今の世代が同じ：残す。どちらもない（一度も全消去していない）ときも残す
 * - 記録がなく今の世代がある（以前の版が保存した入力を含む）・世代が違う：捨てる
 *
 * 捨て切れなかったときは復元・保存を止め、通知の登録後に失敗と再試行を表示する。世代は記録し直さない。
 *
 * @param local - localStorage。参照できない環境では null（世代なしとして扱う）。
 * @param session - sessionStorage。参照できない環境では null（何もしない）。
 */
export function discardClearedTabData(local: StorageLike | null, session: StorageLike | null): void {
  if (!session) return;
  const current = local ? safe(() => local.getItem(CLEAR_KEY), null) : null;
  const saved = safe(() => session.getItem(TAB_GENERATION_KEY), null);
  if (saved !== current && !safe(() => clearAppData(session), false)) {
    lifecycle.begin();
    notifyResult(false, clearTabData);
    return;
  }
  if (current !== null) safe(() => session.setItem(TAB_GENERATION_KEY, current), undefined);
}

/** 通知がまだ届いていなくても、消去前に開いていたタブからの更新を止める。 */
export const isClearingData = () => lifecycle.blocked || readClearGeneration() !== tabGeneration;
/**
 * localStorage の変更が全消去の通知か。`localStorage.clear()`（key が null）と、消去世代の記録だけを通知とみなす。
 *
 * @remarks
 * ほかのキーが消えたことは通知として扱わない。起動時の整理（preferences.ts の pruneStaleKeys）が古いキーを消すため、
 * 通知として扱うと、新しく開いたタブが古いキーを消したときに、開いているほかのタブが全消去してしまう
 */
function isClearEvent(event: StorageEvent): boolean {
  return event.key === null || (event.key === CLEAR_KEY && event.newValue !== null);
}

/**
 * 別タブで始めた全消去の通知を受け、このタブのデータ（sessionStorage）だけを消す。
 *
 * @remarks
 * 共有の localStorage は消去を始めたタブが消す。通知が遅れて届いたタブが共有領域を消し直すと、
 * 消去後に新しく開いたタブが保存した入力や設定まで消してしまうため、受信側では触れない。
 * メモリ内の入力・鍵・編集履歴は、成功を受けた画面の再読み込みで破棄する。
 */
function receiveClear(): void {
  if (lifecycle.blocked) return;
  lifecycle.begin();
  clearTabData();
}

/**
 * 消去世代が、このタブを開いたときから変わっていれば、通知を受けたときと同じく、このタブのデータを消して再読み込みさせる。
 *
 * @remarks
 * 全消去の通知（storage イベント・BroadcastChannel）は、受け取りを登録する前や、キャッシュにある間には届かない。
 * 届かないまま世代だけが変わると、isClearingData が true のまま保存を黙って止め続け、メモリ内の入力も残るため、
 * 「世代がずれたら必ず receiveClear」を、受け取りの登録の直後・storage イベント・タブへの復帰のすべてで確かめる。
 */
function receiveClearIfGenerationChanged(): void {
  if (readClearGeneration() !== tabGeneration) receiveClear();
}

/** このタブの sessionStorage だけを消す。失敗したら、同じ処理を再試行として渡す */
function clearTabData(): void {
  const clearTab = () => notifyResult(operations.clearTab(), clearTabData);
  void withStorageLock(clearTab, clearTab).catch(() => notifyResult(false, clearTabData));
}

/** 現在のタブや別タブで始めた全消去の結果を受け取る。 */
export function subscribeClearData(listener: ClearListener): () => void {
  const unsubscribe = lifecycle.subscribe(listener);
  /** 全消去の通知のほか、ほかのキーの変更でも世代を確かめる（世代の記録の通知だけを取りこぼした場合に備える） */
  const onStorage = (event: StorageEvent) => {
    if (!safe(() => event.storageArea === localStorage, false)) return;
    if (isClearEvent(event)) receiveClear();
    else receiveClearIfGenerationChanged();
  };
  window.addEventListener('storage', onStorage);
  /**
   * 戻る・進むのキャッシュ（bfcache）から戻ったとき。キャッシュにある間は storage イベントも BroadcastChannel も届かないため、
   * 消去世代が変わっていれば、通知を受けたときと同じく、このタブのデータを消して再読み込みさせる。
   * キャッシュからでない表示（通常の読み込み）は、起動時の照合（discardClearedTabData）に任せる
   */
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) receiveClearIfGenerationChanged();
  };
  window.addEventListener('pageshow', onPageShow);
  /** タブ間だけの通知。入力値は送らず、ストレージが使用できない場合も消去を伝える。 */
  const channel = safe(() => new BroadcastChannel(CLEAR_CHANNEL), undefined);
  if (channel) channel.onmessage = (event) => { if (event.data === 'clear') receiveClear(); };
  /** 起動（このモジュールの読み込み）から受け取りを登録するまでの間に、別タブで全消去された場合は、通知が届かない */
  receiveClearIfGenerationChanged();
  return () => {
    unsubscribe();
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('pageshow', onPageShow);
    channel?.close();
  };
}

/**
 * 保存データをすべて消し、結果を画面へ通知する。
 * 通常の保存解除通知は送らず、別タブへ専用の消去通知を送る。
 * 再読み込みまでの非同期入力更新による書き戻しも、消去中フラグで防ぐ。
 */
export function clearAllData(): void {
  lifecycle.begin();
  void withStorageLock(clearAndNotify, clearAndNotify).catch(() => finishClear({
    local: 'unknown', session: false, recorded: false,
  }));
}

const recordGeneration = () => safe(() => {
  localStorage.setItem(CLEAR_KEY, crypto.getRandomValues(new Uint32Array(4)).join('-'));
  return true;
}, false);

const broadcastClear = () => safe(() => {
  const channel = new BroadcastChannel(CLEAR_CHANNEL);
  channel.postMessage('clear');
  channel.close();
}, undefined);

const operations = createClearOperations({ local: () => localStorage, session: () => sessionStorage, recordGeneration });

/** 消去世代を先に記録してから削除し、別タブへ入力を含まない通知を送る。 */
function clearAndNotify(): void {
  const state = operations.start();
  broadcastClear();
  finishClear(state);
}

/**
 * 結果を通知する。失敗したときの再試行は、失敗した処理だけをやり直す。
 * 全消去をやり直すと、消去の後に別タブが保存した入力や設定まで消してしまうため
 */
function finishClear(state: ClearState): void {
  const sharedPending = state.local === 'unknown' || state.local.size > 0 || !state.recorded;
  const done = !sharedPending && state.session;
  notifyResult(done, () => {
    void withStorageLock(() => retryOwnClear(state), () => retryOwnClear(state)).catch(() => finishClear(state));
  }, sharedPending);
}

function retryOwnClear(state: ClearState): void {
  operations.retry(state);
  finishClear(state);
}

/** 成功のときは結果だけを、失敗のときは再試行の処理も渡す */
function notifyResult(success: boolean, retry: () => void, sharedPending = false): void {
  lifecycle.finish(success ? { ok: true } : { ok: false, retry, sharedPending });
}
