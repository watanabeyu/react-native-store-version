// `check` サブコマンドのチェックを順に回す（spec 9.3）
import { checkInstalled } from './checks/installed.ts';
import { checkPeers } from './checks/peers.ts';
import { checkStore, type StoreIds } from './checks/store.ts';
import type { CheckEntry, CheckId } from './result.ts';

/** {@link runChecks} のオプション */
export type CheckOptions = {
  /** 確かめるアプリのディレクトリ（絶対パス） */
  cwd: string;
  /** C3 の App Store の国 */
  country: string;
  /** 回さない（結果にも出さない）チェック */
  ignore: ReadonlySet<string>;
};

/** チェックを C1 → C3 → C7 の順に回す。`ignore` にあるものは回さない */
export const runChecks = async ({
  cwd,
  country,
  ignore,
}: CheckOptions): Promise<CheckEntry[]> => {
  const enabled = (id: CheckId) => !ignore.has(id);
  const entries: CheckEntry[] = [];

  if (enabled('C1')) {
    entries.push(...checkInstalled(cwd));
  }
  if (enabled('C3')) {
    // C3 は C2（Expo の設定・pbxproj・gradle からの ID の特定）が見つけた ID を引く。C2 は 4b で足すので、
    // それまでは ID が無く、C3 は「飛ばした」になる
    const ids: StoreIds = {};
    entries.push(...(await checkStore(ids, { country })));
  }
  if (enabled('C7')) {
    entries.push(...checkPeers(cwd));
  }
  return entries;
};
