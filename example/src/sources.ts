// 最新 / 最低バージョンの取得元の 3 パターン（ストア / 静的な JSON / 自前の API。後の 2 つは README の「Your own version source」の例と同じ形）。
// どれも `getLatestVersion` / `getMinimumVersion` に渡す関数で、失敗は throw すれば onError に渡る
import type { VersionGetter } from 'react-native-store-version';

/** example で切り替える取得元 */
export type Source = 'store' | 'json' | 'api';

export type VersionGetters = {
  getLatestVersion?: VersionGetter;
  getMinimumVersion?: VersionGetter;
};

// ---------------------------------------------------------------------------
// 1. ストア（ゼロコンフィグ）: 何も渡さない。version / bundleId / packageName は expo-application から自動で取る。
//    この example の ID はストアに公開されていないので、iOS も Android も NOT_FOUND が onError に出る。
//
// 2 / 3 でも、iOS はストアを開く URL を得るために bundleId で lookup する。この example の ID は App Store に無いので、
// iOS では STORE_URL_UNAVAILABLE が onError に出て、「更新」を押してもストアは開かない（Android は package 名から URL を作るので開く）

// ---------------------------------------------------------------------------
// 2. 静的な JSON を fetch する（GitHub Pages / S3 / CDN などに置く）。
//    既定はこのリポジトリの master ブランチの example/app-version.json。
//    手元のサーバーで試すときは EXPO_PUBLIC_VERSION_JSON_URL で差し替える（Metro の起動時に読まれる。
//    Android エミュレータは `adb reverse tcp:8080 tcp:8080` で localhost を使える）
const VERSION_JSON_URL =
  process.env.EXPO_PUBLIC_VERSION_JSON_URL ??
  'https://raw.githubusercontent.com/watanabeyu/react-native-store-version/master/example/app-version.json';

type VersionJson = Record<
  'ios' | 'android',
  { latest?: string; minimum?: string }
>;

// getLatestVersion と getMinimumVersion は 1 回の判定で同じ signal を受け取る（VersionGetterContext.signal の約束）ので、
// signal ごとに fetch を 1 回にまとめる（まとめないと同じ JSON を 2 回取る）。判定が終われば signal ごと捨てられる
const pending = new WeakMap<AbortSignal, Promise<VersionJson>>();

const fetchVersionJson = (signal: AbortSignal): Promise<VersionJson> => {
  let promise = pending.get(signal);
  if (!promise) {
    promise = (async () => {
      // CDN のキャッシュを避けたいときは URL にタイムスタンプを付けるか、配信側の Cache-Control を短くする
      const res = await fetch(VERSION_JSON_URL, { signal });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return (await res.json()) as VersionJson;
    })();
    pending.set(signal, promise);
  }
  return promise;
};

const jsonSource: VersionGetters = {
  getLatestVersion: async ({ platform, signal }) =>
    (await fetchVersionJson(signal))[platform].latest,
  getMinimumVersion: async ({ platform, signal }) =>
    (await fetchVersionJson(signal))[platform].minimum,
};

// ---------------------------------------------------------------------------
// 3. 自前の API（この example では通信しないモック）。force / warning / none / 失敗を切り替えて試せる。
//    本物の API なら `fetch(url, { signal })` で取り、`res.ok` でなければ throw する
export type MockScenario = 'force' | 'warning' | 'none' | 'fail';

/** example の app.json の version は 1.0.0。それに対する応答 */
const MOCK_RESPONSES: Record<
  Exclude<MockScenario, 'fail'>,
  { latest: string; minimum: string | null }
> = {
  // minor の差分（policy だけなら warning）だが、local（1.0.0）が最低バージョンを下回るので force
  force: { latest: '1.6.0', minimum: '1.5.0' },
  // minor の差分。デフォルトの policy では warning
  warning: { latest: '1.1.0', minimum: null },
  none: { latest: '1.0.0', minimum: null },
};

const MOCK_DELAY_MS = 300;

/** 通信の代わりに少し待つ。signal が abort されたら止める（本物の fetch に signal を渡したときと同じ動き） */
const delay = (signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, MOCK_DELAY_MS);
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
  });

const mockApi = async (
  scenario: MockScenario,
  signal: AbortSignal
): Promise<{ latest: string; minimum: string | null }> => {
  await delay(signal);
  if (scenario === 'fail') {
    throw new Error('HTTP 503');
  }
  return MOCK_RESPONSES[scenario];
};

const apiSource = (scenario: MockScenario): VersionGetters => ({
  getLatestVersion: async ({ signal }) =>
    (await mockApi(scenario, signal)).latest,
  getMinimumVersion: async ({ signal }) =>
    (await mockApi(scenario, signal)).minimum,
});

// ---------------------------------------------------------------------------

export const gettersFor = (
  source: Source,
  scenario: MockScenario
): VersionGetters => {
  switch (source) {
    case 'store':
      return {};
    case 'json':
      return jsonSource;
    case 'api':
      return apiSource(scenario);
  }
};
