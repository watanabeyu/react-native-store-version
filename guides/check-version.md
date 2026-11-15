# `checkVersion` / `compareVersion`

[Back to README](../README.md)

Check the store version outside React with `checkVersion`, and compare two versions with `compareVersion`.

The lightest way to use the library: call `checkVersion` outside React (at app start, in a background task, ...) and decide what to do with the result yourself. It shows no UI and has no `policy`. Everything else matches the Provider: the same auto-detection of the version and ID, the same skipped environments, the same defaults (`country` is the device's region, `timeoutMs` is 10 seconds), and nothing is cached.

```ts
import { checkVersion, StoreVersionError } from 'react-native-store-version';

const checkStoreVersion = async () => {
  try {
    const check = await checkVersion();
    if (check.status === 'skipped') return; // web, Expo Go, or not iOS / Android
    if (check.result === 'new') {
      console.log(`${check.local} → ${check.remote} (${check.diff})`);
    }
  } catch (error) {
    // a failed check must not stop the app: log it and go on
    if (error instanceof StoreVersionError) {
      console.warn(error.code, error.message);
    }
  }
};

// don't await it during startup
void checkStoreVersion();
```

`checkVersion` rejects when the check fails, so keep the `try` / `catch`, and don't make your app's startup wait for it.

## Arguments

All optional. `checkVersion()` with no arguments works when `expo-application` or `react-native-device-info` is installed.

| Argument            | Default                  | Description                                                                                                                                                             |
| ------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`           | auto                     | The app version. **Must be the native version**, as for the Provider (see [Provider props](../README.md#provider-props)).                                               |
| `bundleId`          | auto                     | iOS bundle ID.                                                                                                                                                          |
| `packageName`       | auto                     | Android package name.                                                                                                                                                   |
| `country`           | device region, else `us` | App Store country for the lookup. iOS only.                                                                                                                             |
| `timeoutMs`         | `10000`                  | Timeout for the whole check (the latest and the minimum version).                                                                                                       |
| `signal`            | –                        | An `AbortSignal` that cancels the check.                                                                                                                                |
| `getLatestVersion`  | –                        | Replaces the store version; the store is not contacted. See [Your own version source](./version-sources.md#your-own-version-source). `null` is the same as omitting it. |
| `getMinimumVersion` | –                        | Fills `minimum` / `belowMinimum` in the result. `null` is the same as omitting it.                                                                                      |

There is no `policy` (the function shows nothing; decide from the result) and there are no store URL arguments (`iosStoreURL` / `androidStoreURL` were removed in 2.1.0: pass `bundleId` / `packageName`, or nothing).

```ts
const controller = new AbortController();

const checkStoreVersion = async () => {
  try {
    const check = await checkVersion({
      version: '1.0.0', // the native version
      bundleId: 'com.example.app',
      packageName: 'com.example.app',
      country: 'jp',
      timeoutMs: 5000,
      signal: controller.signal,
      getMinimumVersion: async ({ platform, signal }) => {
        const res = await fetch(
          `https://api.example.com/app/minimum-version?platform=${platform}`,
          { signal }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { minimumVersion } = await res.json();
        return minimumVersion; // '2.3.0'
      },
    });
    if (check.status === 'ready' && check.belowMinimum) {
      // the app is older than `check.minimum`
    }
  } catch (error) {
    console.warn(error);
  }
};

void checkStoreVersion();
```

## Result

The promise resolves to one of two shapes; narrow on `status` before reading the rest.

- `{ status: 'skipped', reason }`: nothing was checked and the store was not contacted. `reason` is `'web'`, `'unsupported-platform'` (not iOS / Android) or `'expo-go'` (the type `SkipReason`). Expo Go is skipped even when you pass the version and IDs yourself; use a development build.
- `{ status: 'ready', ... }` with these fields:

| Field          | Type                                                         | Meaning                                                                                                                        |
| -------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `local`        | `string`                                                     | The app version (the one you passed, or the detected one).                                                                     |
| `remote`       | `string`                                                     | The latest version (the store's, or the value of `getLatestVersion`).                                                          |
| `result`       | `'new' \| 'old' \| 'equal'`                                  | `new` when `remote` is newer than `local`. Same as `compareVersion(local, remote)`.                                            |
| `detail`       | `'remote > local' \| 'remote < local' \| 'remote === local'` | The same comparison, spelled out.                                                                                              |
| `diff`         | `'major' \| 'minor' \| 'patch' \| null`                      | Kind of difference. Set only when `result === 'new'`.                                                                          |
| `minimum`      | `string \| null`                                             | The value of `getMinimumVersion`. `null` when it isn't passed or returns nothing.                                              |
| `belowMinimum` | `boolean`                                                    | `local` is older than `minimum`. `false` when `minimum` is `null`.                                                             |
| `releaseNotes` | `string \| undefined`                                        | "What's new" of the current store version, on iOS and Android. `undefined` with `getLatestVersion` or when the store has none. |
| `releaseDate`  | `string \| undefined`                                        | Release date of the current store version, ISO 8601 in UTC (`2026-11-05T22:49:03Z`). `undefined` in the same cases.            |

## Errors and cancellation

Every failure rejects with a [`StoreVersionError`](../README.md#errors); look at its `code`. `checkVersion` uses `LOCAL_VERSION_UNAVAILABLE`, `TIMEOUT`, `NETWORK`, `NOT_FOUND`, `PARSE_FAILED`, `LATEST_VERSION_FAILED`, `INVALID_VERSION` and `MINIMUM_VERSION_FAILED`. Two of them behave differently from the Provider, because there is no `onError` to report a partial failure to:

- `INVALID_VERSION`: when the latest version can't be compared (for example Google Play's "Varies with device"), the call rejects even if you pass `getMinimumVersion`.
- `MINIMUM_VERSION_FAILED`: when only `getMinimumVersion` fails (it throws, returns a value that can't be compared, or doesn't finish within `timeoutMs`), the call rejects even though the latest version was read.

Cancelling through `signal` is the one rejection that is not a `StoreVersionError`: the promise rejects with `signal.reason` as it is, which is an error named `AbortError` unless you passed your own reason to `abort()`. On React Native versions whose `AbortController` does not keep a reason, it is always an error named `AbortError`. A signal that is already aborted rejects the same way, before anything else happens.

```ts
const controller = new AbortController();

checkVersion({ signal: controller.signal })
  .then((check) => {
    // ...
  })
  .catch((error) => {
    // a cancelled check is not a failure worth reporting
    if (error?.name !== 'AbortError') {
      console.warn(error);
    }
  });

controller.abort(); // the check rejects with controller.signal.reason
```

## `compareVersion`

The comparison on its own, without any request:

```ts
import { compareVersion } from 'react-native-store-version';

compareVersion('1.0.0', '1.1.0'); // 'new' ('old' | 'equal' for the other cases)
```
