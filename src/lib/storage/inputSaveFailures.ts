/** 未保存の入力を、使用中の画面内だけで通知する。値そのものは保存しない。 */
export type InputSaveFailure = { id: symbol; read: () => string; retry: () => void };
const failures = new Map<symbol, InputSaveFailure>();
const listeners = new Set<() => void>();
let snapshot: readonly InputSaveFailure[] = [];

export const getInputSaveFailures = () => snapshot;
export const hasInputSaveFailure = (id: symbol) => failures.has(id);
export function subscribeInputSaveFailures(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function setInputSaveFailure(id: symbol, failure: InputSaveFailure | null): void {
  if (failure) failures.set(id, failure);
  else if (!failures.delete(id)) return;
  snapshot = [...failures.values()];
  listeners.forEach((listener) => listener());
}
