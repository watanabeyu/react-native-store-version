# react-native-store-version

Check the App Store / Google Play version of your React Native / Expo app and show a **force update** or a dismissible **update available** prompt. JavaScript only, no native code, zero runtime dependencies.

```tsx
import { StoreVersionProvider } from 'react-native-store-version';

export default function Root() {
  return (
    <StoreVersionProvider>
      <App />
    </StoreVersionProvider>
  );
}
```

That is all. On launch, the Provider reads the app's version and bundle ID / package name (via `expo-application` or `react-native-device-info`), asks the store for the latest version, and shows a modal when the app is behind: a force-update card for a **major** difference and a dismissible bottom sheet for **minor** / **patch**. Your app renders immediately and keeps working if the check fails.

I've only been updating occasionally, but I'd be happy to sponsor you to keep me motivated.
https://github.com/sponsors/watanabeyu

Upgrading from v1? See [MIGRATION.md](./MIGRATION.md). Release notes are in [CHANGELOG.md](./CHANGELOG.md).

## Table of contents

- [Installation](#installation)
- [Requirements](#requirements)
- [How it works](#how-it-works)
- [Policy: force, warning or nothing](#policy-force-warning-or-nothing)
- [Customizing the UI](#customizing-the-ui)
- [Your own version source](#your-own-version-source)
- [`useStoreVersion` hook](#usestoreversion-hook)
- [Provider props](#provider-props)
- [Errors](#errors)
- [Notes and caveats](#notes-and-caveats)
- [CI check](#ci-check)
- [Performance](#performance)
- [`checkVersion` / `compareVersion`](#checkversion--compareversion)
- [Example app](#example-app)
- [Contributing](#contributing)
- [Credits and license](#credits-and-license)

## Installation

```bash
npm install react-native-store-version
# or
pnpm add react-native-store-version
```

To let the Provider read the app version and ID automatically, have one of these in your app (both are optional peer dependencies; nothing else is required):

| App               | Package                                                  |
| ----------------- | -------------------------------------------------------- |
| Expo              | `expo-application` (`npx expo install expo-application`) |
| Bare React Native | `react-native-device-info`                               |

If neither is installed, pass `version`, `bundleId` and `packageName` to the Provider yourself (see [Provider props](#provider-props)).

## Requirements

|                             | Supported |
| --------------------------- | --------- |
| React Native                | `>=0.73`  |
| React                       | 18 / 19   |
| Expo SDK                    | `>=52`    |
| TypeScript (your app)       | `>=5.0`   |
| Node.js (CI check CLI only) | `>=22.14` |

The library runs anywhere React Native runs except **Expo Go**: inside Expo Go the Provider does nothing (`status: 'skipped'`) because the detected bundle ID belongs to Expo Go itself. Use a development build to try it. It also does nothing on web and on platforms other than iOS / Android.

## How it works

- **Checks on every launch.** Nothing is cached or persisted. The check runs when the Provider mounts (and again on `recheck()`, when `enabled` turns true, or on foreground if you opt in with `recheckOnForeground`).
- **Never blocks your app.** Children render right away. The modal is layered on top once the result is known.
- **Fails quietly.** Timeouts (default 10 s) and errors never show UI; they go to `onError` (and to `console.warn` in development if you don't pass `onError`).
- **Sources.** iOS uses the iTunes Lookup API by bundle ID. Android reads the Google Play web page by package name (about 1.25 MB per check). You can replace both with [your own source](#your-own-version-source).
- **"Later" lasts until the next launch.** Dismissing the warning is kept in memory only, so it shows again next time the app starts (or sooner, if a newer version appears on a recheck).
- **Store country.** Defaults to the device locale's region (falls back to `us`). Set `country` if your app is published elsewhere.

## Policy: force, warning or nothing

The `policy` prop maps the kind of difference to an action. The default is:

```tsx
<StoreVersionProvider policy={{ major: 'force', minor: 'warning', patch: 'warning' }}>
```

Three forms are accepted:

```tsx
// one action for every difference (same feeling as v1's result === 'new')
<StoreVersionProvider policy="force">

// per kind; omitted keys use the default
<StoreVersionProvider policy={{ minor: 'force' }}>

// a function
<StoreVersionProvider policy={(local, remote) => (remote.startsWith('3.') ? 'force' : 'warning')}>
```

Order of evaluation:

1. If `getMinimumVersion` returns a version and the app is below it, the action is `force` regardless of the policy.
2. If the app is up to date (or newer than the store), the action is `none`.
3. Otherwise the kind of difference (`major` / `minor` / `patch`) picks the action from the policy.

A difference only in the 4th segment (`1.2.3.4` → `1.2.3.5`) or only in a prerelease tag (`1.2.3-beta` → `1.2.3`) counts as `patch`.

> **Warning: Android staged rollouts.**
> If you use a staged rollout on Google Play, users outside the rollout cannot download the new version yet, but the store page already shows it. A force update driven by the store version would lock those users out of your app with no way to update.
> On Android, use `major: 'warning'` (for example `policy={{ major: Platform.OS === 'android' ? 'warning' : 'force' }}`), or decide force updates with [`getMinimumVersion`](#your-own-version-source) instead of the store version.
> iOS phased releases are not affected: they only throttle _automatic_ updates, and anyone can update manually from the App Store at any time.

## Customizing the UI

Three levels, from the smallest change to full control.

### 1. Texts

```tsx
<StoreVersionProvider
  texts={{
    force: { title: 'Update required', update: 'Update now' },
    warning: { later: 'Not now' },
  }}
>
```

Keys you don't set fall back to the English defaults (merged per `force` / `warning`). `{remote}` and `{local}` are replaced with the latest / current version when shown.

| Key               | Default                                                                         |
| ----------------- | ------------------------------------------------------------------------------- |
| `force.title`     | Update required                                                                 |
| `force.message`   | A new version ({remote}) is available. Please update to continue using the app. |
| `force.update`    | Update                                                                          |
| `warning.title`   | Update available                                                                |
| `warning.message` | Version {remote} is now available.                                              |
| `warning.update`  | Update                                                                          |
| `warning.later`   | Later                                                                           |

A Japanese preset is included:

```tsx
import ja from 'react-native-store-version/texts/ja';

<StoreVersionProvider texts={ja}>

// start from the preset and change one key
<StoreVersionProvider texts={{ ...ja, force: { ...ja.force, title: '更新してください' } }}>
```

Changing `texts` updates a modal that is already on screen, so it follows an in-app language switch. To use an i18n library, put a small wrapper inside its provider:

```tsx
import { useTranslation } from 'react-i18next';

function AppStoreVersionProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <StoreVersionProvider
      texts={{
        force: {
          title: t('update.force.title'),
          message: t('update.force.message'),
          update: t('update.button'),
        },
        warning: {
          title: t('update.warning.title'),
          message: t('update.warning.message'),
          update: t('update.button'),
          later: t('update.later'),
        },
      }}
    >
      {children}
    </StoreVersionProvider>
  );
}
```

### Icon and button color

```tsx
<StoreVersionProvider
  icon={require('./assets/icon.png')} // shown above the title (force) / at the top left (warning); omitted = no icon
  primaryColor="#E11D48"              // the "Update" button fill and the "Later" label; same in light and dark
>
```

The app icon isn't read automatically (it can't be done from JavaScript reliably on both platforms), so pass it as an image source. `primaryColor` applies to both color schemes; if you want a different color per scheme, pass a value you picked with `useColorScheme()` (or `DynamicColorIOS` on iOS). Keep it readable on white (button label) and on the dark sheet background.

### 2. Components

Replace the contents of the force card and / or the warning sheet. The library still owns the modal, the backdrop, the placement (force: centered with 24 px side margins; warning: full width at the bottom), the back-button / backdrop-tap behavior, and the open / close animation. Your component draws the surface itself (background, radius, shadow, max width).

```tsx
import type { StoreVersionForceProps, StoreVersionWarningProps } from 'react-native-store-version';

function MyForce({ texts, local, remote, releaseNotes, openStore }: StoreVersionForceProps) {
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header">{texts.title}</Text>
      <Text>{texts.message}</Text>
      <Text>{local} → {remote ?? '?'}</Text>
      {releaseNotes ? <Text numberOfLines={4}>{releaseNotes}</Text> : null}
      <Button title={texts.update} onPress={() => void openStore()} />
    </View>
  );
}

function MyWarning({ texts, openStore, dismiss }: StoreVersionWarningProps) {
  return (
    <View style={styles.sheet}>
      <Text accessibilityRole="header">{texts.title}</Text>
      <Text>{texts.message}</Text>
      <Button title={texts.later} onPress={dismiss} />
      <Button title={texts.update} onPress={() => void openStore()} />
    </View>
  );
}

// define the components outside render: a new component function on each render remounts the card's contents
// (a new `components` object on each render is fine)
const components = { Force: MyForce, Warning: MyWarning };

<StoreVersionProvider components={components}>
```

Props: `local`, `remote` (may be `null` when only the minimum version could be compared), `storeUrl`, `releaseNotes` (iOS with the store version only; `undefined` on Android and with `getLatestVersion`), `texts` (placeholders already filled), `icon`, `openStore()`; `Warning` also gets `dismiss()`. `primaryColor` does not apply to replaced components. A full example is in [`example/src/CustomUi.tsx`](./example/src/CustomUi.tsx).

### 3. Hook only

Pass `ui={false}` and render whatever you like with [`useStoreVersion`](#usestoreversion-hook), for example a dedicated screen in your navigator.

```tsx
<StoreVersionProvider ui={false}>
```

## Your own version source

Instead of (or in addition to) the store, you can return versions from Firebase Remote Config, a JSON file, or your API. Both props are async functions that return a version string. `getMinimumVersion` may also return `null` / `undefined` / `''` to mean "no minimum". `getLatestVersion` must return a version: an empty value fails the check (`LATEST_VERSION_FAILED`, no UI, no fallback to the store).

```ts
type VersionGetter = (ctx: {
  platform: 'ios' | 'android';
  signal: AbortSignal; // aborted on timeout; pass it to fetch
}) => Promise<string | null | undefined>;
```

| Prop                | Effect                                                                                                                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getLatestVersion`  | Replaces the store version. Android never contacts Google Play; iOS still looks up the bundle ID once, only to get the store URL for the "Update" button. If this function fails, the check fails (no fallback to the store). |
| `getMinimumVersion` | Any app version below this is forced to update, whatever the policy says. Works with the store version or with `getLatestVersion`. If it fails, only the minimum-version rule is skipped (the error still goes to `onError`). |

### A static JSON file (GitHub Pages, S3, a CDN, ...)

```json
{
  "ios": { "latest": "2.4.0", "minimum": "2.3.0" },
  "android": { "latest": "2.4.0", "minimum": "2.3.0" }
}
```

```tsx
type VersionJson = Record<'ios' | 'android', { latest?: string; minimum?: string }>;

const fetchVersionJson = async (signal: AbortSignal): Promise<VersionJson> => {
  const res = await fetch('https://example.com/app-version.json', { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

<StoreVersionProvider
  getLatestVersion={async ({ platform, signal }) => (await fetchVersionJson(signal))[platform].latest}
  getMinimumVersion={async ({ platform, signal }) => (await fetchVersionJson(signal))[platform].minimum}
>
```

This fetches the file twice per check. Both getters receive the **same** `signal` within one check, so you can dedupe on it:

```tsx
const pending = new WeakMap<AbortSignal, Promise<VersionJson>>();

const fetchVersionJsonOnce = (signal: AbortSignal): Promise<VersionJson> => {
  let promise = pending.get(signal);
  if (!promise) {
    promise = fetchVersionJson(signal);
    pending.set(signal, promise);
  }
  return promise;
};
```

### Your own API

```tsx
<StoreVersionProvider
  getMinimumVersion={async ({ platform, signal }) => {
    const res = await fetch(`https://api.example.com/app/minimum-version?platform=${platform}`, {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { minimumVersion } = await res.json();
    return minimumVersion; // '2.3.0'
  }}
>
```

### Firebase Remote Config (`@react-native-firebase/remote-config`)

```tsx
import remoteConfig from '@react-native-firebase/remote-config';

<StoreVersionProvider
  getMinimumVersion={async ({ platform }) => {
    await remoteConfig().fetchAndActivate();
    return remoteConfig().getValue(`minimum_version_${platform}`).asString(); // '' means "not set"
  }}
>
```

Notes:

- Throw on failure; the error reaches `onError` (as `LATEST_VERSION_FAILED` / `MINIMUM_VERSION_FAILED` with the original error in `cause`).
- Pass `signal` to `fetch`. Otherwise the request keeps running after the timeout (its result is ignored).
- A JSON file behind a CDN is only as fresh as the CDN cache. Use a short `Cache-Control` or add a timestamp to the URL.
- In React `StrictMode` (development only), both getters may be called twice on mount. Requests to the stores are always deduplicated.
- Changing an inline getter does not trigger a new check; the check runs on mount, `recheck()`, foreground (if enabled) and when `enabled` turns true.

## `useStoreVersion` hook

Works anywhere under the Provider. The Provider holds a single result, so using the hook in many places does not add requests.

```tsx
import { useStoreVersion } from 'react-native-store-version';

// a banner at the top of the settings screen, visible even after the warning was dismissed
function UpdateBanner() {
  const { result, remote, openStore } = useStoreVersion();
  if (result !== 'new') return null;
  return (
    <Pressable onPress={openStore} style={styles.banner}>
      <Text>Version {remote} is available. Tap to update.</Text>
    </Pressable>
  );
}

// a "Version" row that shows current / latest and rechecks on tap
function VersionRow() {
  const { local, remote, status, recheck } = useStoreVersion();
  return (
    <Pressable onPress={recheck}>
      <Text>
        Current {local ?? '-'} / Latest{' '}
        {status === 'checking' ? 'checking…' : (remote ?? '-')}
      </Text>
    </Pressable>
  );
}
```

| Field              | Type                                                                 | Meaning                                                                                                          |
| ------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `status`           | `'idle' \| 'checking' \| 'ready' \| 'skipped' \| 'error'`            | Progress. `skipped` = web / Expo Go / unsupported platform / `enabled={false}`.                                  |
| `result`           | `'new' \| 'old' \| 'equal' \| null`                                  | Comparison, same values as v1's `checkVersion()`. Not affected by `policy`.                                      |
| `detail`           | `'remote > local' \| 'remote < local' \| 'remote === local' \| null` | Same as v1.                                                                                                      |
| `action`           | `'force' \| 'warning' \| 'none' \| null`                             | What the policy (and the minimum version) decided. The default UI follows this.                                  |
| `diff`             | `'major' \| 'minor' \| 'patch' \| null`                              | Kind of difference when `result === 'new'`.                                                                      |
| `dismissed`        | `boolean`                                                            | `action` is `warning` but "Later" was tapped.                                                                    |
| `local` / `remote` | `string \| null`                                                     | Current / latest version.                                                                                        |
| `storeUrl`         | `string \| null`                                                     | Store page URL. `null` on iOS while it is being looked up or if the lookup failed.                               |
| `releaseNotes`     | `string \| undefined`                                                | From the App Store, iOS only. `undefined` on Android and when `getLatestVersion` is used.                        |
| `openStore()`      | `() => Promise<boolean>`                                             | Opens the store page. Resolves `true` if it opened, `false` otherwise (never rejects; failures go to `onError`). |
| `dismiss()`        | `() => void`                                                         | Closes the warning until the next launch (or a newer version).                                                   |
| `recheck()`        | `() => void`                                                         | Checks again. The previous result stays visible meanwhile and is restored if the recheck fails.                  |
| `error`            | `StoreVersionError \| null`                                          | Why the check failed (only when `status === 'error'`).                                                           |

During a recheck (`status: 'checking'`) the previous `result` / `action` remain, so a force modal never disappears while rechecking. Calling the hook outside the Provider throws.

## Provider props

All props are optional.

| Prop                  | Default                                                  | Description                                                                                                                                                                                                                                                                                                                                |
| --------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `enabled`             | `true`                                                   | `false` does nothing (`skipped`). Switching to `true` starts a check; switching to `false` cancels it.                                                                                                                                                                                                                                     |
| `version`             | auto                                                     | The app version. **Must be the native version** (`CFBundleShortVersionString` / `versionName`). Don't pass `Constants.expoConfig.version` or `package.json`'s version: they live in the JS bundle and change with OTA updates, which would hide a needed force update. Auto-detected from `expo-application` → `react-native-device-info`. |
| `bundleId`            | auto                                                     | iOS bundle ID.                                                                                                                                                                                                                                                                                                                             |
| `packageName`         | auto                                                     | Android package name.                                                                                                                                                                                                                                                                                                                      |
| `country`             | device region, else `us`                                 | App Store country for the lookup.                                                                                                                                                                                                                                                                                                          |
| `policy`              | `{ major: 'force', minor: 'warning', patch: 'warning' }` | See [Policy](#policy-force-warning-or-nothing). Changing it re-evaluates `action` without a new request.                                                                                                                                                                                                                                   |
| `timeoutMs`           | `10000`                                                  | Timeout for the whole check. On timeout: no UI, `TIMEOUT` to `onError`.                                                                                                                                                                                                                                                                    |
| `recheckOnForeground` | `false`                                                  | Recheck when the app returns from the background (`background` → `active`). On Android this also fires after permission dialogs and other apps, and each check downloads the Play page (about 1.25 MB).                                                                                                                                    |
| `getLatestVersion`    | –                                                        | See [Your own version source](#your-own-version-source).                                                                                                                                                                                                                                                                                   |
| `getMinimumVersion`   | –                                                        | See [Your own version source](#your-own-version-source).                                                                                                                                                                                                                                                                                   |
| `onResult`            | –                                                        | `(r) => void`, called with `{ result, detail, action, diff, local, remote }` each time a check completes, and again when a `policy` change changes `action`. Not called for `skipped` / `error`.                                                                                                                                           |
| `onError`             | `console.warn` in dev                                    | `(e: StoreVersionError) => void`. May be called more than once per check (for example a failed minimum-version fetch plus a failed store lookup).                                                                                                                                                                                          |
| `texts`               | English                                                  | See [Texts](#1-texts).                                                                                                                                                                                                                                                                                                                     |
| `icon`                | none                                                     | Image source for the default UI.                                                                                                                                                                                                                                                                                                           |
| `components`          | default UI                                               | See [Components](#2-components).                                                                                                                                                                                                                                                                                                           |
| `primaryColor`        | blue                                                     | Button color of the default UI.                                                                                                                                                                                                                                                                                                            |
| `ui`                  | `true`                                                   | `false` hides the default UI (hook only).                                                                                                                                                                                                                                                                                                  |

## Errors

`onError` and `useStoreVersion().error` receive a `StoreVersionError` with a `code` (and the original error in `cause` when there is one). No code ever shows UI on its own; the app keeps working.

| `code`                      | When                                                                                                        | Check result                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `LOCAL_VERSION_UNAVAILABLE` | The app version / ID can't be read (no `expo-application` / `react-native-device-info` and nothing passed). | `error`                                                                          |
| `TIMEOUT`                   | The latest version didn't arrive within `timeoutMs`.                                                        | `error`                                                                          |
| `NETWORK`                   | HTTP / network failure, or an unreadable App Store response.                                                | `error`                                                                          |
| `NOT_FOUND`                 | The app isn't on the store (App Store returned no results / Google Play 404).                               | `error`                                                                          |
| `PARSE_FAILED`              | The Google Play page changed and the version couldn't be extracted.                                         | `error`                                                                          |
| `INVALID_VERSION`           | A version can't be compared (for example Google Play's "Varies with device").                               | `error` (or `ready` with `action: 'force'` if the minimum version still applies) |
| `LATEST_VERSION_FAILED`     | `getLatestVersion` threw or returned an empty / non-string value.                                           | `error`                                                                          |
| `MINIMUM_VERSION_FAILED`    | `getMinimumVersion` threw, returned a non-string or a version that can't be compared, or timed out.         | `ready` (minimum rule skipped)                                                   |
| `POLICY_FAILED`             | A `policy` function threw or returned something other than `force` / `warning` / `none`.                    | `error`                                                                          |
| `STORE_URL_UNAVAILABLE`     | The store URL couldn't be looked up or opened (`openStore()` returns `false`).                              | unchanged                                                                        |

## Notes and caveats

- **Native version only.** See `version` in [Provider props](#provider-props). OTA updates (Expo Updates, CodePush) don't change the native version, and that is what the store compares against.
- **App Store cache.** The iTunes Lookup API sits behind a CDN. The library adds a timestamp to the URL and sends `cache-control: no-cache` to get fresh data, but right after you release a new version the lookup may still lag behind for a while.
- **Google Play is scraped.** There is no public API for the Play version, so the library reads the store's web page. The page can change without notice (the version is then reported as `PARSE_FAILED`, with no UI), the request is about 1.25 MB, and Google's terms of service may restrict automated access; review them. If you need certainty, or want to avoid contacting Google Play altogether, use `getLatestVersion` with your own source (`getMinimumVersion` alone still reads the Play page for the latest version).
- **Android staged rollouts** can lock users out when force is driven by the store version. See [Policy](#policy-force-warning-or-nothing).
- **"Later" is not persisted.** There is no storage; the warning returns on the next launch. If you need a longer snooze, use `ui={false}` and the hook with your own storage.
- **`recheckOnForeground` on Android** downloads the Play page on every return to the foreground.
- **Metro `allowOptionalDependencies`.** The optional peers are loaded with `try { require('expo-application') }`. With Metro's default settings a missing peer is fine; if your `metro.config.js` sets `transformer.allowOptionalDependencies: false`, bundling fails when a peer is missing, so install one of them or re-enable the option.
- **Other modals.** The default UI is a React Native `Modal` at your root. On iOS, while another `Modal` (or a native modal screen from `react-native-screens` / `expo-router`) is presented, the force / warning modal may not appear, and there is no guarantee that it appears after the other one closes (the reverse can also happen: your modal may not show while this one is open). This has not been verified on real devices yet. If a force update must never be missed, use `ui={false}` and show the hook's result in your own screen.
- **Warning dismissal.** The warning sheet also closes with the Android back button, a tap on the backdrop, and the VoiceOver escape gesture, all equivalent to "Later". The force card can't be dismissed.
- **StrictMode.** In development, `getLatestVersion` / `getMinimumVersion` may run twice on mount.
- **`onError` can fire more than once per check.**
- **Expo Go** is skipped. Use a development build.

## CI check

The package ships a CLI that checks an app's setup, and a GitHub Action that runs it after your dependencies are installed.

```bash
npx react-native-store-version check [--cwd <dir>] [--strict] [--ignore C4,C8] [--country us] [--json]
```

```yaml
jobs:
  store-version:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: npm ci
      - uses: watanabeyu/react-native-store-version@v2
        with:
          working-directory: . # the app directory (monorepo: apps/mobile)
          strict: false # true fails on warnings too
          ignore: '' # e.g. C8
          country: us # App Store country for C3
```

| ID  | What it checks                                                                                                                                                                                                                                                                                            | Level                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| C1  | `react-native-store-version` is installed and is v2 or later.                                                                                                                                                                                                                                             | error if missing (or, in the Action, if only v1 is installed) / info if v1 |
| C2  | The iOS bundle ID and Android package can be determined (Expo config, `ios/` project, `android/app/build.gradle`).                                                                                                                                                                                        | error if neither / info if only one                                        |
| C3  | The app can be found on the App Store (`country`) and Google Play with those IDs. Store access from CI is unreliable, so failures stay warnings.                                                                                                                                                          | warning                                                                    |
| C4  | The native versions (`MARKETING_VERSION`, `versionName`) and the Expo `version` match. Skipped when there is no `ios/` / `android/` directory (Continuous Native Generation).                                                                                                                             | warning (info if a native version can't be determined)                     |
| C7  | `expo-application` or `react-native-device-info` is installed for auto-detection.                                                                                                                                                                                                                         | info                                                                       |
| C8  | Only when an Android package was found: the Provider seems to force updates from the store version alone (no `policy`, `'force'` in it, an object without `major`, or `{undefined}` / `{null}`, and no `getLatestVersion` / `getMinimumVersion` anywhere in the sources). Prints the staged-rollout note. | warning (info if the scan was cut short)                                   |

- Exit code is 1 on any error, and also on warnings with `--strict`. Info never fails. On GitHub Actions the results are shown as annotations and in the job summary.
- C8 is a plain text search and can be a false positive (a policy that already uses `major: 'warning'` only on Android still contains `'force'`). Silence it with `--ignore C8` / `ignore: C8`.
- Node.js 22.14 or later is required for the CLI. The Action uses the Node set up in your job.
- **The CLI evaluates your `app.config.ts` / `app.config.js`**, which means code from the checked commit runs in the job. Treat the job as untrusted: don't use it in `pull_request_target` jobs, don't expose secrets through `env:` at the job or workflow level, keep the token read-only (`permissions: contents: read`), and don't leave credentials on disk from earlier steps (`persist-credentials: false` on checkout, no `.npmrc` with a token). The Action itself takes no token or secrets.
- Pin `uses:` to the major tag (`@v2`) or to a commit SHA.
- The Action fails (C1) when v1 is installed, because v1 has no CLI.

## Performance

Measured in the [example app](./example) on release builds, on a simulator / emulator (iPhone 17 on iOS 26.5; Pixel 3a on API 34), against a published app (GitHub, country `jp`), from mount to `onResult`, median of 5 runs after one warm-up:

|         | v1 `checkVersion()` | v2 Provider (`ui={false}`, IDs given) |
| ------- | ------------------- | ------------------------------------- |
| iOS     | 199 ms              | 161 ms                                |
| Android | 205 ms              | 198 ms                                |

Added bundle size for the Provider and the default UI: about 39.8 KB minified / about 11 KB gzipped (Hermes bytecode: about 75 KB more than an empty app). The library has no runtime dependencies.

## `checkVersion` / `compareVersion`

The lightest way to use the library: call `checkVersion` outside React (for example once at app start) and decide what to do with the result yourself. It returns the same values and error messages as v1 (see [MIGRATION.md](./MIGRATION.md) for the few differences).

```ts
import { checkVersion, compareVersion } from 'react-native-store-version';

const { local, remote, result, detail } = await checkVersion({
  version: '1.0.0', // the native version
  iosStoreURL: 'https://apps.apple.com/jp/app/github/id1477376905',
  androidStoreURL:
    'https://play.google.com/store/apps/details?id=com.github.android',
  country: 'jp', // default 'jp' (unlike the Provider)
  timeoutMs: 10000, // new in v2; omitted = no timeout
});
// result: 'new' | 'old' | 'equal', detail: 'remote > local' | 'remote < local' | 'remote === local'

compareVersion('1.0.0', '1.1.0'); // 'new'
```

In v2 every argument is optional; omitted ones are auto-detected like the Provider does. `checkVersion` does not skip Expo Go, so pass everything explicitly when testing there. Failures reject with an `Error` carrying the v1 message, except timeouts (`StoreVersionError`, `code: 'TIMEOUT'`).

> **Planned for 2.1.0:** `checkVersion` will be updated to follow the rest of v2. This may include breaking changes.

## Example app

[`example/`](./example) is an Expo app in this repository that switches between the store, a static JSON file and a mock API, and shows the Japanese preset, `icon`, `components`, `primaryColor`, `ui={false}`, the settings-screen banner, and the timing measurement against v1.

```bash
pnpm install
pnpm build
cd example
pnpm ios      # or pnpm android
```

## Contributing

- `pnpm install --frozen-lockfile`, then `pnpm lint` (Biome), `pnpm typecheck`, `pnpm test` (Jest), `pnpm build`.
- Tests live in `__tests__/` mirroring `src/` (for example `src/fetchers/ios.ts` → `__tests__/fetchers/ios.test.ts`); fixtures in `__tests__/__fixtures__/`. Tests must not hit the real stores: mock `fetch` and return a fixture.
- UI tests use `@testing-library/react-native`. Query through `screen` (not the result of `render`), prefer `getByRole` / `findByRole` over text or test IDs, and `await` every `findBy*` / `waitFor`. Any `console.error` / `console.warn` during a test fails it.
- Keep the library free of native code and runtime dependencies. The CLI (`src/cli/`) may only use Node's standard modules and the library's own code.

## Credits and license

Version comparison is a vendored copy of [compare-versions](https://github.com/omichelsen/compare-versions) 6.1.1 by Ole Michelsen (MIT), kept in `src/vendor/compare-versions.ts` with its license header, so the package has no runtime dependencies.

MIT. See [LICENSE.md](./LICENSE.md).
