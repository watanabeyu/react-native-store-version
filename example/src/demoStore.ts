// README のスクリーンショット用の取得元（?source=demo）。iOS だけで、App Store の iTunes Lookup の応答を
// サンプルの内容（版・リリースノート・公開日）に差し替える。実ストアには出ない。
// ストアの応答を偽るのは example だけで、ライブラリには無い（ライブラリは global の fetch をそのまま呼ぶ）。
// Android は Play のページを偽らず、api（モックの API）と同じ取得元にする（src/sources.ts の gettersFor）
// アプリの起動直後に ?source=demo で開くと、最初の Provider（既定の api）が始めた iTunes Lookup の取得を、demo の Provider が
// 共有して本物の応答を受け取ることがある（ライブラリは同じ問い合わせを 1 回にまとめる）。そのときは同じ URL をもう一度開く
import { Platform } from 'react-native';

import type { MockScenario } from './sources';

type DemoState = {
  active: boolean;
  lang: 'en' | 'ja';
  scenario: MockScenario;
};

// Provider が取得を始める前に読めるよう、描画の中で同期的に書き換える（setDemo）。effect で書き換えると間に合わない
const state: DemoState = { active: false, lang: 'en', scenario: 'force' };

/** 今 demo か、言語と scenario を伝える。ProviderHost の描画の中で呼ぶ */
export const setDemo = (next: DemoState) => {
  state.active = next.active;
  state.lang = next.lang;
  state.scenario = next.scenario;
};

// example の app.json の version は 1.0.0。force は major の差、それ以外は minor の差（既定の policy では warning）
const DEMO_VERSION = { force: '2.0.0', warning: '1.1.0' } as const;

// デザインのモックと同じサンプルの文章（他のアプリのリリースノートを README に載せないため）
const DEMO_NOTES = {
  en: 'Faster and easier to use.\n\n• Your feed loads up to twice as fast\n• A new dark theme for the editor\n• Share lists with friends from the menu\n\nFixes\n\n• Fixed a crash when opening notifications\n• Fixed the date picker on small screens\n• Better labels for screen readers',
  ja: 'より速く、使いやすくなりました。\n\n• フィードの読み込みが最大 2 倍速く\n• エディタにダークテーマを追加\n• メニューからリストを友だちと共有\n\n修正\n\n• 通知を開くと落ちることがあった問題を修正\n• 小さい画面で日付の選択が崩れる問題を修正\n• スクリーンリーダーの読み上げを改善',
} as const;

// 正午（UTC）にしておくと、多くのタイムゾーンで同じ日（11 月 5 日）になる
const DEMO_RELEASE_DATE = '2026-11-05T12:00:00Z';

// 実在しないページ。「更新」を押しても開かなくてよい
const DEMO_TRACK_VIEW_URL = 'https://apps.apple.com/app/id0000000000';

// ライブラリは lookup の URL の末尾に時刻を付けるので、前方一致で見る
const LOOKUP_PREFIX = 'https://itunes.apple.com/lookup';

const urlOf = (input: RequestInfo): string =>
  typeof input === 'string' ? input : input.url;

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
  g.fetch = ((input: RequestInfo, init?: RequestInit) =>
    state.active && urlOf(input).startsWith(LOOKUP_PREFIX)
      ? Promise.resolve(demoLookup())
      : original(input, init)) as typeof fetch;
}
