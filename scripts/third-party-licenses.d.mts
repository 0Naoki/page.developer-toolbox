/** scripts/third-party-licenses.mjs の型（vite.config.ts から使う。スクリプトは型チェックの対象外のため、使う関数の型だけを書く） */
export function packageDirOf(id: string, root: string): string | null;
export function thirdPartyLicenseText(moduleIds: Iterable<string>, root: string): string;
