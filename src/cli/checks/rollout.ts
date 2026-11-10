// C8: Android の段階公開の注意（spec 9.3 / 4.4）。Google Play の段階公開では、公開対象外のユーザーは新しい版を入手できない。
// ストアの版との差分で force にしていると、その人たちはアプリを使えなくなる。ソースの簡易なテキスト検索で、
// その設定になっていそうなときに注意を出す（誤検知はありうるので、--ignore C8 で抑止できることを書く）
import { displayPath } from '../project/files.ts';
import { findOpeningTags } from '../project/jsx.ts';
import {
  SCAN_LIMITS,
  type ScanLimits,
  scanSources,
} from '../project/sources.ts';
import type { CheckEntry } from '../result.ts';

const PROVIDER = 'StoreVersionProvider';

/** ストアの差分によらず版を渡す関数。どこかで使っていれば、force をストアの差分だけで決めていない */
const VERSION_GETTERS = /\b(getLatestVersion|getMinimumVersion)\b/;

/** 一覧に出すファイルの数（多いと 1 行が長くなりすぎる） */
const MAX_LISTED = 5;

const files = (n: number) => `${n} file${n === 1 ? '' : 's'}`;

const listFiles = (files: readonly string[]): string =>
  files.length > MAX_LISTED
    ? `${files.slice(0, MAX_LISTED).join(', ')} and ${files.length - MAX_LISTED} more`
    : files.join(', ');

const ROLLOUT_NOTE =
  "If you use a staged rollout on Google Play, users outside the rollout cannot get the new version, so a force update from the store version can leave them unable to use the app. When Platform.OS === 'android', set major: 'warning' in the policy, or control force with getMinimumVersion. This is a simple text search and may be a false positive; suppress it with --ignore C8";

/** policy 属性の値（`{…}` / `"…"` の書かれたまま）に `'force'` / `"force"` があるか */
const hasForce = (value: string): boolean => /'force'|"force"/.test(value);

/**
 * 1 つのファイルの `<StoreVersionProvider …>` の開始タグのうち、ストアの差分で force になりそうなものの理由
 * （policy 属性が無い = デフォルトの major が force。spec 4.4 / policy の値に `'force'` がある）。重複は 1 つにする
 */
const forceReasons = (source: string): string[] => {
  const reasons = new Set<string>();
  for (const tag of findOpeningTags(source, PROVIDER)) {
    const policy = tag.attributes.find(({ name }) => name === 'policy');
    if (policy === undefined) {
      reasons.add("has no policy prop (the default policy has major: 'force')");
    } else if (policy.value !== null && hasForce(policy.value)) {
      reasons.add("has 'force' in its policy");
    }
  }
  return [...reasons];
};

/**
 * C8。Android の package が特定できたときだけ（無ければ skipped）。`<cwd>` の下のソースを走査し、
 * `<StoreVersionProvider>` の開始タグが force になりそうなファイルごとに warning。ただし `getLatestVersion` /
 * `getMinimumVersion` が走査したどこかのファイルにあれば、どれも出さない。ファイル数の上限を超えたら判定せずに info
 */
export const checkRollout = (
  cwd: string,
  androidPackage: string | null,
  limits: ScanLimits = SCAN_LIMITS
): CheckEntry[] => {
  if (androidPackage === null) {
    return [
      {
        id: 'C8',
        level: 'skipped',
        message:
          'no Android package was determined, so the staged rollout note does not apply',
      },
    ];
  }

  const flagged: { file: string; reasons: string[] }[] = [];
  let getterFile: string | null = null;
  const scan = scanSources(
    cwd,
    (path, source) => {
      if (getterFile === null && VERSION_GETTERS.test(source)) {
        getterFile = displayPath(cwd, path);
      }
      if (source.includes(PROVIDER)) {
        const reasons = forceReasons(source);
        if (reasons.length > 0) {
          flagged.push({ file: displayPath(cwd, path), reasons });
        }
      }
    },
    limits
  );

  if (scan.truncated) {
    return [
      {
        id: 'C8',
        level: 'info',
        message: `stopped scanning the sources at ${files(limits.maxFiles)} (.ts / .tsx / .js / .jsx outside node_modules, ios, android, and build output), so the staged rollout note was not checked. Check --cwd, or suppress this with --ignore C8`,
      },
    ];
  }

  const entries: CheckEntry[] = [];
  if (scan.tooLarge.length > 0) {
    entries.push({
      id: 'C8',
      level: 'info',
      message: `did not scan ${scan.tooLarge.length} source ${scan.tooLarge.length === 1 ? 'file' : 'files'} larger than ${limits.maxFileBytes} bytes: ${listFiles(scan.tooLarge.map((path) => displayPath(cwd, path)))}`,
    });
  }

  if (getterFile !== null || flagged.length === 0) {
    entries.push({
      id: 'C8',
      level: 'ok',
      message:
        getterFile !== null
          ? `getLatestVersion / getMinimumVersion is used (${getterFile}), so force updates do not depend only on the store version`
          : `no <${PROVIDER}> that forces updates from the store version was found (${files(scan.scanned)} scanned)`,
    });
    return entries;
  }

  for (const { file, reasons } of flagged) {
    entries.push({
      id: 'C8',
      level: 'warning',
      message: `${file}: <${PROVIDER}> ${reasons.join(' / ')}, and getLatestVersion / getMinimumVersion is not used in the sources. ${ROLLOUT_NOTE}`,
    });
  }
  return entries;
};
