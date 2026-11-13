// README のスクリーンショット用の取得元（?source=demo）。iOS では、demo 専用の bundleId（DEMO_BUNDLE_ID）を Provider に渡し、
// その bundleId の iTunes Lookup の応答だけをサンプルの内容（版・リリースノート・公開日）に差し替える。実ストアには出ない。
// ストアの応答を偽るのは example だけで、ライブラリには無い（ライブラリは global の fetch をそのまま呼ぶ）。
// demo 専用の bundleId にするのは、ほかの Provider（既定の api や計測の Measure.tsx）の問い合わせを巻き込まないため
// （ライブラリは同じ問い合わせを 1 回にまとめるので、同じ bundleId だと起動直後の取得を共有してしまう）。
// Android は Play のページを偽らず、api（モックの API）と同じ取得元にする（src/sources.ts の gettersFor）
import { Platform } from 'react-native';

import type { Lang } from './i18n';
import type { MockScenario } from './sources';

/** demo のときに Provider に渡す bundleId（App Store には無い。差し替えの目印） */
export const DEMO_BUNDLE_ID = 'com.github.watanabeyu.rnsv.example.demo';

type DemoState = {
  lang: Lang;
  scenario: MockScenario;
};

const state: DemoState = { lang: 'en', scenario: 'force' };

/**
 * 応答の言語と scenario を伝える。ProviderHost の useLayoutEffect で呼ぶ（子の Provider の取得は useEffect で始まるので、
 * 同じ commit の layout effect のほうが先に走る）。言語は Provider が取得したときの値で、画面の Texts の切り替えでは
 * 取り直さない（URL の lang か「Check again」で作り直す）
 */
export const setDemo = (next: DemoState) => {
  state.lang = next.lang;
  state.scenario = next.scenario;
};

// example の app.json の version は 1.0.0。force は major の差、それ以外は minor の差（既定の policy では warning）
const DEMO_VERSION = { force: '2.0.0', warning: '1.1.0' } as const;

// README のスクリーンショット用のサンプルの文章（実在のアプリのものではない）
const DEMO_NOTES: Record<Lang, string> = {
  en: 'Faster and easier to use.\n\n• Your feed loads up to twice as fast\n• A new dark theme for the editor\n• Share lists with friends from the menu\n\nFixes\n\n• Fixed a crash when opening notifications\n• Fixed the date picker on small screens\n• Better labels for screen readers',
  ja: 'より速く、使いやすくなりました。\n\n• フィードの読み込みが最大 2 倍速く\n• エディタにダークテーマを追加\n• メニューからリストを友だちと共有\n\n修正\n\n• 通知を開くと落ちることがあった問題を修正\n• 小さい画面で日付の選択が崩れる問題を修正\n• スクリーンリーダーの読み上げを改善',
};

// 正午（UTC）にしておくと、多くのタイムゾーンで同じ日（11 月 5 日）になる
const DEMO_RELEASE_DATE = '2026-11-05T12:00:00Z';

// 実在しないページ。「更新」を押しても開かなくてよい
const DEMO_TRACK_VIEW_URL = 'https://apps.apple.com/app/id0000000000';

// ライブラリは lookup の URL（https://itunes.apple.com/lookup?bundleId=...&country=...）の末尾に時刻を付ける
const LOOKUP_PREFIX = 'https://itunes.apple.com/lookup?';
const DEMO_QUERY = `bundleId=${encodeURIComponent(DEMO_BUNDLE_ID)}`;

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url;

const isDemoLookup = (url: string): boolean =>
  url.startsWith(LOOKUP_PREFIX) &&
  url.slice(LOOKUP_PREFIX.length).split('&').includes(DEMO_QUERY);

const demoLookup = (): Response =>
  new Response(
    JSON.stringify({
      resultCount: 1,
      results: [
        {
          version:
            state.scenario === 'warning'
              ? DEMO_VERSION.warning
              : DEMO_VERSION.force,
          trackViewUrl: DEMO_TRACK_VIEW_URL,
          releaseNotes: DEMO_NOTES[state.lang],
          currentVersionReleaseDate: DEMO_RELEASE_DATE,
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );

type DemoGlobal = typeof globalThis & {
  __rnsvOriginalFetch?: typeof fetch;
};

// 読み込んだときに 1 回だけ包む（Fast Refresh でモジュールが読み直されても、元の fetch を二重に包まない）
if (Platform.OS === 'ios') {
  const g = globalThis as DemoGlobal;
  g.__rnsvOriginalFetch ??= g.fetch;
  const original = g.__rnsvOriginalFetch;
  g.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    isDemoLookup(urlOf(input))
      ? Promise.resolve(demoLookup())
      : original(input as RequestInfo, init)) as typeof fetch;
}
