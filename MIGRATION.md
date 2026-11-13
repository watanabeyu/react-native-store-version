# Migration guide

- [2.0 → 2.1](#20--21): `checkVersion()` was rebuilt. Read this if you call `checkVersion()` on 2.0.x.
- [v1 → v2](#v1--v2): moving from 1.x.

## 2.0 → 2.1

2.1.0 rebuilds `checkVersion()` on the same detection, store access and errors as the Provider. This breaks the 2.0 (v1-style) `checkVersion()` in a minor release: an app installed with `^2.0.0` gets 2.1.0 without asking for it, so check the list below if you call `checkVersion()`. `compareVersion()` is unchanged.

If you only use `StoreVersionProvider` / `useStoreVersion`, there are two things to look at:

- The public types `UseStoreVersionResult`, `StoreVersionForceProps` and `StoreVersionWarningProps` have a new required field `releaseDate` (`string | undefined`). Code that builds objects of these types by hand (Storybook stories, test mocks) needs `releaseDate: undefined` added. Components that only read the props are not affected.
- On iOS, empty release notes from the App Store are now `undefined` instead of `''`.

Before (2.0):

```ts
import { checkVersion } from 'react-native-store-version';

const checkStoreVersion = async () => {
  try {
    const { result, remote } = await checkVersion({
      version: '1.0.0',
      iosStoreURL: 'https://apps.apple.com/jp/app/my-app/id123456789',
      androidStoreURL:
        'https://play.google.com/store/apps/details?id=com.example.app',
    });
    if (result === 'new') {
      console.log(`version ${remote} is available`);
    }
  } catch (e) {
    console.warn(e);
  }
};

void checkStoreVersion(); // don't make startup wait for it
```

After (2.1):

```ts
import { checkVersion, StoreVersionError } from 'react-native-store-version';

const checkStoreVersion = async () => {
  try {
    // the version and the IDs are read from the app; pass `version` / `bundleId` / `packageName` to override
    const check = await checkVersion({ country: 'jp' }); // 2.0 defaulted to `jp`
    if (check.status === 'ready' && check.result === 'new') {
      console.log(`version ${check.remote} is available`);
    }
  } catch (error) {
    if (error instanceof StoreVersionError) {
      console.warn(error.code, error.message);
    }
  }
};

void checkStoreVersion(); // don't make startup wait for it
```

The full description of the new function is in the [README](./README.md#checkversion--compareversion).

### What TypeScript reports

- **`iosStoreURL` / `androidStoreURL` are gone.** The app is identified by `bundleId` (iOS) and `packageName` (Android, the `id=` part of the Play URL). Both can be omitted when `expo-application` or `react-native-device-info` is installed.
- **The default export is gone.** Use the named import: `import { checkVersion } from 'react-native-store-version'`.
- **The type `CheckVersionResponse` is gone.** Use `CheckVersionResult` (and `CheckVersionParams` for the arguments).
- **The result has a `status`.** It is either `{ status: 'skipped', reason }` or `{ status: 'ready', local, remote, result, detail, ... }`. `local` / `remote` / `result` / `detail` hold the same values as before, but you have to narrow on `status === 'ready'` to read them. New fields on `ready`: `diff`, `minimum`, `belowMinimum`, `releaseNotes`, `releaseDate`.

### What TypeScript does not report

|                                             | 2.0                                                                          | 2.1                                                                                                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `country` when omitted                      | `jp`                                                                         | The device's region, or `us` if it can't be read. Pass `country: 'jp'` to keep the old behavior.                                                            |
| `timeoutMs` when omitted                    | No timeout                                                                   | `10000` (10 seconds). A value that is not a positive finite number (such as `0`) turns the timeout off.                                                     |
| Expo Go                                     | Not skipped                                                                  | Not checked: resolves `{ status: 'skipped', reason: 'expo-go' }`, even when you pass the version and IDs. Use a development build.                          |
| Web, and platforms other than iOS / Android | Not skipped                                                                  | Not checked: resolves `{ status: 'skipped', reason: 'web' }` or `'unsupported-platform'`.                                                                   |
| Errors                                      | A plain `Error` with the v1 message (`StoreVersionError` only for a timeout) | Always a `StoreVersionError` (`error.name === 'StoreVersionError'`) with a `code`. The v1 messages are gone, so compare `error.code`, not `error.message`.  |
| Cancelling                                  | Not available                                                                | The new `signal` argument. An aborted check rejects with `signal.reason` as it is (an error named `AbortError` by default), not with a `StoreVersionError`. |

Also worth knowing:

- A version that can't be compared (Google Play's "Varies with device") rejects with `INVALID_VERSION`, and a failing `getMinimumVersion` rejects with `MINIMUM_VERSION_FAILED`. The codes are listed in the [README](./README.md#errors-and-cancellation).
- An App Store response that is not JSON (an HTTP 503 page, for example) now rejects with `NETWORK` instead of a JSON parse error.

## v1 → v2

v2 keeps `checkVersion()` and `compareVersion()` working as before and adds a Provider with a built-in force / warning UI, a hook, custom version sources, and a CI check. Most apps can upgrade in one of three ways.

> **Changed in 2.1.0:** `checkVersion()` no longer works as in v1. Coming from v1 straight to 2.1 or later, read [2.0 → 2.1](#20--21) above as well.

### Before you start

Check the [breaking changes](#breaking-changes) below. In short: React Native `>=0.73`, React 18 / 19, TypeScript `>=5.0` in your app, the package is now ESM with an `exports` map, and `compareVersion` uses a newer comparison algorithm.

```bash
npm install react-native-store-version@2
```

### Path 1: keep using `checkVersion`

> **Changed in 2.1.0:** this path describes 2.0. From 2.1.0 the arguments, the result and the errors are different, and the default import below no longer works (only the named import does). See [2.0 → 2.1](#20--21) above.

Nothing to change. The function returns the same `{ local, remote, result, detail }` and rejects with the same messages (details in [breaking changes](#breaking-changes)).

`checkVersion` is planned to be updated in 2.1.0 to follow the rest of v2, which may include breaking changes (see the [README](./README.md#checkversion--compareversion)).

The only recommendation is to switch from the default import to a named import. The default export stays, but the named one is what the documentation uses and what the rest of the API (`StoreVersionProvider`, `useStoreVersion`, ...) is exported as:

```diff
- import checkVersion from 'react-native-store-version';
+ import { checkVersion } from 'react-native-store-version';
```

New in v2 (all optional): `version` / `iosStoreURL` / `androidStoreURL` can be omitted and are detected from `expo-application` or `react-native-device-info`, and `timeoutMs` adds a timeout.

### Path 2: `checkVersion` + your own `Alert` → `StoreVersionProvider`

If you called `checkVersion` on startup and showed an `Alert`, the Provider replaces both the call and the alert.

Before (v1):

```tsx
import checkVersion from 'react-native-store-version'; // v1 only has the default export

const IOS_URL = 'https://apps.apple.com/jp/app/my-app/id123456789';
const ANDROID_URL =
  'https://play.google.com/store/apps/details?id=com.example.app';
const STORE_URL = Platform.OS === 'ios' ? IOS_URL : ANDROID_URL;

export default function App() {
  useEffect(() => {
    checkVersion({
      version: '1.0.0',
      iosStoreURL: IOS_URL,
      androidStoreURL: ANDROID_URL,
    })
      .then(({ result }) => {
        if (result === 'new') {
          Alert.alert('Update required', 'Please update the app.', [
            { text: 'Update', onPress: () => Linking.openURL(STORE_URL) },
          ]);
        }
      })
      .catch(console.warn);
  }, []);
  return <Main />;
}
```

After:

```tsx
import { StoreVersionProvider } from 'react-native-store-version';

export default function App() {
  return (
    <StoreVersionProvider
      policy="force" // v1-style: any newer version forces (the default is force for major, warning for minor / patch)
      texts={{
        force: {
          title: 'Update required',
          message: 'Please update the app.',
          update: 'Update',
        },
      }}
      onError={console.warn}
    >
      <Main />
    </StoreVersionProvider>
  );
}
```

What changes for you:

- The version, bundle ID and package name are read from the app (`expo-application` or `react-native-device-info`). Store URLs are no longer needed; the store page is derived from the app's own ID.
- `country` now defaults to the device's region (not `jp`). Pass `country="jp"` if you relied on the old default.
- The UI is a modal with your texts. For a less abrupt experience, drop `policy="force"` and keep the default (force only on major), or decide force updates with `getMinimumVersion` ([README](./README.md#your-own-version-source)).
- Expo Go is skipped automatically; test in a development build.
- Before shipping on Android, read the staged-rollout warning in the [README](./README.md#policy-force-warning-or-nothing).

### Path 3: `checkVersion` + your own screen → `useStoreVersion` + `ui={false}`

If you navigated to your own "update" screen, keep that screen and feed it from the hook. `result` / `detail` / `local` / `remote` hold exactly the values `checkVersion` returned, so conditions like `result === 'new'` move over unchanged.

> **Changed in 2.1.0:** `checkVersion` now returns these values under `status: 'ready'`. See [2.0 → 2.1](#20--21) above.

```tsx
import {
  StoreVersionProvider,
  useStoreVersion,
} from 'react-native-store-version';

export default function App() {
  return (
    <StoreVersionProvider ui={false} onError={console.warn}>
      <Navigation />
    </StoreVersionProvider>
  );
}

function UpdateGate({ children }: { children: React.ReactNode }) {
  const { action, remote, openStore } = useStoreVersion();
  if (action === 'force') {
    return <UpdateScreen remote={remote} onUpdate={openStore} />;
  }
  return <>{children}</>;
}
```

- `action` tells you what the policy decided (`force` / `warning` / `none`), separately from the raw comparison in `result`. Gate on `action`, not on `result`: a force driven by `getMinimumVersion` can happen even when `result` is `null`, `'old'` or `'equal'`, and the default UI also looks at `action` only.
- `openStore()` opens the right store page and never rejects (it resolves `false` and reports to `onError` on failure), so it can be passed straight to `onPress`.
- `recheck()`, `dismiss()`, `status` and `error` are also available; see the hook table in the [README](./README.md#usestoreversion-hook).

### Breaking changes

#### Requirements

- **React Native `>=0.73` and React `>=18`** are now declared as peer dependencies (v1 declared none). React 18 and 19 are supported.
- **TypeScript `>=5.0`** in your app. The type definitions use `./foo.ts` import specifiers, which TypeScript 4.9 rejects (error TS2691).
- **Node.js `>=22.14`** for the CI check CLI. The library itself does not depend on Node.
- **Expo SDK `>=52`.**

#### Package format

- The package is **ESM** (`"type": "module"`) and has an **`exports` map**. The compiled files use ES module syntax (as v1's did). If your Jest config transforms this package, keep it in the `transformIgnorePatterns` exception.
- **Deep imports are no longer supported.** Only these entry points are public:
  - `react-native-store-version`
  - `react-native-store-version/texts/ja`
  - `react-native-store-version/package.json`

  Where `exports` is honored, `react-native-store-version/dist/...` (or `/src/...`) imports fail to resolve. Older tooling (Metro before React Native 0.79, TypeScript with `moduleResolution: node`) may still resolve them, but they are internal and can change in any release. The v1 modules `dist/ios` / `dist/android` (`getIOSVersion` / `getAndroidVersion`) no longer exist at all.
- **Named import recommended.** `import checkVersion from '...'` still works, but prefer `import { checkVersion } from '...'`. (**Changed in 2.1.0:** the default export was removed. See [2.0 → 2.1](#20--21) above.)
- `compare-versions` is no longer a dependency. Its comparison code (6.1.1, MIT) is bundled inside the package; the package has **zero runtime dependencies**.

#### `compareVersion`

The comparison now follows compare-versions 6.1.1 instead of 4.1.x. Results differ only for inputs that stores don't normally produce:

- Prerelease tags: `compareVersion('1.0.0-alpha', '1.0.0-alpha.0')` is now `'equal'` (was `'new'`). Similar edge cases with a 4th segment plus a prerelease tag.
- Leading `^`, `~`, `<`, `>`, `=` or an uppercase `V` (`'^1.0.0'`, `'V1.0.0'`) are now compared by their numbers (v1 couldn't parse them and returned `'equal'`).

Plain `x.y.z` versions compare exactly as before.

#### `checkVersion`

> **Changed in 2.1.0:** this section describes 2.0. See [2.0 → 2.1](#20--21) above.

Given the same arguments v1 required, `checkVersion` returns the same result and rejects with the same messages, with these exceptions:

- **Android version extraction.** More version formats are read from the Play page: versions that v1 rejected with `can't get android app version.` (such as `5`, `1.0.0-beta.1`, `v2.1`) are now returned, so **`remote` is no longer guaranteed to be digits and dots only**. An old version elsewhere on the page is no longer picked up by mistake.
- **Omitted arguments are detected instead of throwing.** On iOS / Android, a missing (or empty) `version`, `iosStoreURL` or `androidStoreURL` is filled from `expo-application` → `react-native-device-info`. `checkVersion()` with no arguments is valid. The v1 errors (`local version is not set.`, `iosStoreURL is not set.`, `androidStoreURL is not set.`) are thrown only when detection isn't possible. On other platforms (web) the v1 behavior is unchanged.
- **Error messages on the detected-bundle-ID path (iOS).** When `iosStoreURL` is omitted and the bundle ID is detected, the lookup is the v2 one: a non-200 response, a null `results[0]`, or a `version` that is not a string rejects with `can't get ios version`, and an unpublished app rejects with `appID(<bundleId>) is not released.` (the bundle ID, not a numeric App ID). With `iosStoreURL` given, the response is handled exactly as in v1 (the status is ignored, the body is parsed as JSON, `country` is not encoded), apart from the `fetch` changes below.
- **Expo Go is not skipped.** Same as v1, but note that with omitted arguments inside Expo Go the detected values are Expo Go's own version and ID. Pass everything explicitly there (the Provider, by contrast, skips Expo Go).
- **`fetch` is called with a `signal`** (`AbortSignal`) in its init, in addition to the v1 `cache-control: no-cache` header on iOS. Concurrent calls for the same URL share one request. This matters only if you mock `fetch` in tests and assert on the init object.
- **New `timeoutMs`.** When it expires, the rejection is a `StoreVersionError` with `code: 'TIMEOUT'` (not a plain `Error`; v1 had no timeout). Omitted = no timeout, as before.

#### Behavior worth knowing (not v1 API changes)

- The Provider's `country` defaults to the device's region (falls back to `us`). `checkVersion` keeps `jp`. (**Changed in 2.1.0:** it uses the device's region too. See [2.0 → 2.1](#20--21) above.)
- The Provider never throws for a failed check; errors go to `onError`. `checkVersion` still rejects, so keep your `catch`. (**Changed in 2.1.0:** it rejects with a `StoreVersionError`. See [2.0 → 2.1](#20--21) above.)
