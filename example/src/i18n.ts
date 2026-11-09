// example の画面の文言（デフォルト UI の文言はライブラリの texts。日本語は react-native-store-version/texts/ja）
export type Lang = 'en' | 'ja';

export const SETTINGS_TEXTS = {
  en: {
    title: 'Settings',
    banner: (remote: string) => `Version ${remote} is available`,
    bannerSub: 'Tap to update in the store',
    notifications: 'Notifications',
    account: 'Account',
    privacy: 'Privacy',
    about: 'About',
    versionInfo: 'Version',
    versions: (local: string, latest: string) =>
      `Current ${local} / Latest ${latest}`,
    checking: 'checking…',
    recheckHint: 'Tap to check again (recheck)',
  },
  ja: {
    title: '設定',
    banner: (remote: string) => `バージョン ${remote} が利用できます`,
    bannerSub: 'タップしてストアで更新',
    notifications: '通知',
    account: 'アカウント',
    privacy: 'プライバシー',
    about: 'アプリについて',
    versionInfo: 'バージョン情報',
    versions: (local: string, latest: string) =>
      `現在 ${local} / 最新 ${latest}`,
    checking: '確認中…',
    recheckHint: 'タップすると再確認（recheck）',
  },
} as const;
