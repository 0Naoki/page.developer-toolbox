/** vite.config.ts の workerSource プラグイン：Worker のコードを1つにまとめた文字列 */
declare module '*?worker-source' {
  const source: string;
  export default source;
}
