// C7: version / ID の自動取得に使う optional peer があるか。パッケージの解決だけを見て、
// アプリのソースは検索しない（Provider に値を渡しているかは見ない）
import { isInstalled } from '../packages.ts';
import type { CheckEntry } from '../result.ts';

/** 自動取得に使う optional peer（src/detect.ts が読む順） */
export const AUTO_DETECT_PEERS = [
  'expo-application',
  'react-native-device-info',
] as const;

/**
 * C7。どちらかが `<cwd>` から見つかれば（{@link isInstalled}）ok、どちらも無ければ info
 * （`version` / `bundleId` / `packageName` を Provider に渡していれば不要なので、warning にはしない）
 */
export const checkPeers = (cwd: string): CheckEntry[] => {
  const found = AUTO_DETECT_PEERS.filter((name) => isInstalled(cwd, name));
  if (found.length > 0) {
    return [
      {
        id: 'C7',
        level: 'ok',
        message: `${found.join(' and ')} found for detecting the app version and ID`,
      },
    ];
  }
  return [
    {
      id: 'C7',
      level: 'info',
      message: `neither ${AUTO_DETECT_PEERS.join(' nor ')} is installed. Pass version / bundleId / packageName to StoreVersionProvider, or install one of them`,
    },
  ];
};
