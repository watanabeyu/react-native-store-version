// `check` サブコマンドのチェックを順に回す
import { resolveIds } from './checks/ids.ts';
import { checkInstalled } from './checks/installed.ts';
import { checkPeers } from './checks/peers.ts';
import { checkRollout } from './checks/rollout.ts';
import { checkStore } from './checks/store.ts';
import { checkVersions } from './checks/versions.ts';
import { readProject } from './project/index.ts';
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

/** アプリの構成（Expo の設定・ネイティブのプロジェクト）を使うチェック */
const PROJECT_CHECKS: readonly CheckId[] = ['C2', 'C3', 'C4', 'C8'];

/** チェックを C1 → C2 → C3 → C4 → C7 → C8 の順に回す。`ignore` にあるものは回さない */
export const runChecks = async ({
  cwd,
  country,
  ignore,
}: CheckOptions): Promise<CheckEntry[]> => {
  const enabled = (id: CheckId) => !ignore.has(id);
  const entries: CheckEntry[] = [];

  // C3（ID で引く）・C8（Android か）は C2 が特定した ID を使うので、`--ignore C2` でも ID の特定はする（C2 の行だけを出さない）。
  // Expo の設定の評価（アプリの app.config.* を動かす）は、どれも使わないときはしない
  const project = PROJECT_CHECKS.some(enabled) ? readProject(cwd) : null;
  const ids = project === null ? null : resolveIds(project);

  if (enabled('C1')) {
    entries.push(...checkInstalled(cwd));
  }
  if (ids !== null && enabled('C2')) {
    entries.push(...ids.entries);
  }
  if (ids !== null && enabled('C3')) {
    entries.push(
      ...(await checkStore({ ios: ids.ios, android: ids.android }, { country }))
    );
  }
  if (project !== null && enabled('C4')) {
    entries.push(...checkVersions(project));
  }
  if (enabled('C7')) {
    entries.push(...checkPeers(cwd));
  }
  if (ids !== null && enabled('C8')) {
    entries.push(...checkRollout(cwd, ids.android));
  }
  return entries;
};
