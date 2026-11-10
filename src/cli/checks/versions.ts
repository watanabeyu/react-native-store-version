// C4: ローカルの版（Expo の設定の version・iOS・Android）が一致しているか（spec 9.3）。
// ストアの版と比べる「ローカルの版」はプラットフォームごとにアプリへ入る値なので、ずれていると片方だけ判定が変わる
import type { Found } from '../project/files.ts';
import type { ProjectInfo } from '../project/index.ts';
import type { CheckEntry } from '../result.ts';

type Source = {
  /** `iOS` / `Android` / `Expo` */
  name: string;
  /** 見つかった値。見つからなければ理由 */
  found: Found | null;
  reason: string;
};

const describe = (name: string, { label, value, file }: Found) =>
  `${name} ${label} ${value} (${file})`;

/**
 * C4。ネイティブのディレクトリ（`ios/` / `android/`）がどちらも無い（CNG）なら skipped（指摘ではないので注釈にしない）。
 * iOS と Android（ネイティブ同士）、Expo の設定の version と各ネイティブを比べ、ずれている組ごとに warning。
 * 特定できない値は、その値を含む比較を飛ばして info。比べる組が無ければ skipped。比較は文字列の一致
 * （`1.0` と `1.0.0` もずれとして出す。ストアに出る値の書き方を揃えるため）
 */
export const checkVersions = (project: ProjectInfo): CheckEntry[] => {
  if (project.ios === null && project.android === null) {
    return [
      {
        id: 'C4',
        level: 'skipped',
        message:
          'there is no ios/ or android/ directory (Continuous Native Generation), so there are no native versions to compare',
      },
    ];
  }

  const sources: Source[] = [];
  for (const [name, lookup] of [
    ['iOS', project.ios?.version],
    ['Android', project.android?.version],
  ] as const) {
    if (lookup !== undefined) {
      sources.push(
        lookup.value === null
          ? { name, found: null, reason: lookup.reason }
          : { name, found: lookup, reason: '' }
      );
    }
  }
  const config = project.expo?.config;
  if (config) {
    sources.push(
      config.version === null
        ? {
            name: 'Expo',
            found: null,
            reason: `version is not set in ${config.file}`,
          }
        : {
            name: 'Expo',
            found: {
              label: 'version',
              value: config.version,
              file: config.file,
            },
            reason: '',
          }
    );
  }

  const entries: CheckEntry[] = [];
  for (const { name, found, reason } of sources) {
    if (found === null) {
      entries.push({
        id: 'C4',
        level: 'info',
        message: `could not determine the ${name} version (${reason}), so it is not compared`,
      });
    }
  }

  const known = sources.filter(
    (source): source is Source & { found: Found } => source.found !== null
  );
  if (known.length < 2) {
    if (entries.length === 0) {
      entries.push({
        id: 'C4',
        level: 'skipped',
        message: `only one version was found (${known.map(({ name, found }) => describe(name, found)).join('')}), so there is nothing to compare`,
      });
    }
    return entries;
  }

  let differs = false;
  for (let i = 0; i < known.length; i += 1) {
    for (let j = i + 1; j < known.length; j += 1) {
      const a = known[i];
      const b = known[j];
      if (a.found.value !== b.found.value) {
        differs = true;
        entries.push({
          id: 'C4',
          level: 'warning',
          message: `${describe(a.name, a.found)} differs from ${describe(b.name, b.found)}`,
        });
      }
    }
  }
  if (!differs) {
    entries.push({
      id: 'C4',
      level: 'ok',
      message: `the versions match: ${known.map(({ name, found }) => describe(name, found)).join(', ')}`,
    });
  }
  return entries;
};
