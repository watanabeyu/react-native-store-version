# CHANGELOG

## v2.1.0

`checkVersion()` is rebuilt on the same detection, store access and errors as the Provider, and the store's release notes and release date are now available on both platforms. **This minor release breaks the 2.0 `checkVersion()`**: an app installed with `^2.0.0` gets it without asking, so read the list below if you call `checkVersion()`. Apps that only use `StoreVersionProvider` / `useStoreVersion` are affected by the two items under "Changed" at most. See [MIGRATION.md](./MIGRATION.md#20--21) for before / after code.

### Breaking changes

All of them are about `checkVersion()`. `compareVersion()` is unchanged.

Reported by TypeScript:

- `iosStoreURL` / `androidStoreURL` are removed. The app is identified by `bundleId` / `packageName`, which are detected when omitted.
- The default export is removed. Use `import { checkVersion } from 'react-native-store-version'`.
- The type `CheckVersionResponse` is removed. Use `CheckVersionResult`.
- The result has a `status`: `{ status: 'skipped', reason }` or `{ status: 'ready', local, remote, result, detail, ... }`. Narrow on `status === 'ready'` before reading `result`.

Not reported by TypeScript:

- `country` defaults to the device's region (falling back to `us`) instead of `jp`. Pass `country: 'jp'` to keep the old behavior.
- Expo Go, web and platforms other than iOS / Android are skipped: the call resolves `{ status: 'skipped', reason }` without contacting the store (2.0 did not skip them).
- Every failure rejects with a `StoreVersionError` (`name` is `StoreVersionError`, with a `code`) instead of a plain `Error` with the v1 message. Compare `error.code`, not `error.message`.
- A check cancelled through the new `signal` rejects with `signal.reason` as it is (an error named `AbortError` by default), not with a `StoreVersionError`.
- `timeoutMs` defaults to 10 seconds (2.0 had no timeout unless you passed one).

### New

- `releaseNotes` is now returned on Android too, and there is a new `releaseDate` (the release date of the current store version, ISO 8601 in UTC, for example `2026-11-05T22:49:03Z`), on iOS and Android. Both are available from `useStoreVersion()`, the `components` props (`Force` / `Warning`) and `checkVersion()`. They are `undefined` with `getLatestVersion` or when the store doesn't provide them (that never fails the check), the default UI doesn't show them, and `onResult` doesn't receive them. On Android the release notes are in the default language of the Play page (English if the app has an English translation), which may differ from iOS. This answers the requests in [#57](https://github.com/watanabeyu/react-native-store-version/pull/57) (release notes) and [#29](https://github.com/watanabeyu/react-native-store-version/pull/29) (the Play update date).
- `checkVersion()`: new arguments `bundleId` / `packageName` (in place of the store URLs; detected when omitted), `signal` (cancel), `getLatestVersion` and `getMinimumVersion` (your own version source, as on the Provider), next to `version` / `country` / `timeoutMs`. New result fields `diff` (`major` / `minor` / `patch` when `result === 'new'`), `minimum` and `belowMinimum` (from `getMinimumVersion`), `releaseNotes` and `releaseDate`.
- The type `SkipReason` (`'web' | 'unsupported-platform' | 'expo-go'`) is exported.

### Changed

- iOS: `releaseNotes` is `undefined` instead of an empty string when the App Store returns empty release notes.
- The public types `UseStoreVersionResult`, `StoreVersionForceProps` and `StoreVersionWarningProps` have a new required field `releaseDate` (`string | undefined`). If you build objects of these types yourself (Storybook stories, test mocks), add `releaseDate`.

### Fixed

- `checkVersion()` no longer fails with a JSON parse error when the iTunes Lookup API answers with an error status (such as 503) or a body that is not JSON. It rejects with `StoreVersionError` (`code: 'NETWORK'`). ([#55](https://github.com/watanabeyu/react-native-store-version/issues/55), [#59](https://github.com/watanabeyu/react-native-store-version/issues/59), [#46](https://github.com/watanabeyu/react-native-store-version/issues/46))

## v2.0.0

A rewrite. Drop in `<StoreVersionProvider>` and the app shows a force-update modal or a dismissible "update available" sheet on its own; the v1 `checkVersion()` / `compareVersion()` keep working. Still JavaScript only, now with **zero runtime dependencies**. See [MIGRATION.md](./MIGRATION.md) for upgrading and [README.md](./README.md) for the full guide.

### New

- `StoreVersionProvider`: checks the store on every launch without blocking rendering, reads the app version and ID automatically (`expo-application` or `react-native-device-info`, both optional), and never shows UI on failure (errors go to `onError`). Props: `policy`, `country`, `timeoutMs`, `recheckOnForeground`, `enabled`, `getLatestVersion`, `getMinimumVersion`, `onResult`, `onError`, `texts`, `icon`, `components`, `primaryColor`, `ui`, plus `version` / `bundleId` / `packageName` overrides.
- `useStoreVersion()`: `status`, `result` / `detail` (same values as v1), `action`, `diff`, `dismissed`, `local`, `remote`, `storeUrl`, `releaseNotes`, `openStore()`, `dismiss()`, `recheck()`, `error`. Usable anywhere under the Provider without extra requests.
- Default UI: a force card (not dismissible) and a warning bottom sheet ("Later" lasts until the next launch), light / dark, accessible, scrolls with large fonts. `policy` decides which one to show (default: force on major, warning on minor / patch; also `'force'` or a function).
- `texts` with `{remote}` / `{local}` placeholders, a Japanese preset at `react-native-store-version/texts/ja`, `icon`, `primaryColor`, and `components` to replace the card / sheet contents.
- `getLatestVersion` / `getMinimumVersion`: use Firebase Remote Config, a JSON file or your API instead of (or alongside) the store. A minimum version forces updates regardless of the policy.
- `StoreVersionError` with a `code` (`TIMEOUT`, `NETWORK`, `NOT_FOUND`, `PARSE_FAILED`, `INVALID_VERSION`, ...).
- CLI `react-native-store-version check` (Node 22.14+) and a GitHub Action (`uses: watanabeyu/react-native-store-version@v2`) that verify an app's setup: installation (C1), bundle ID / package detection (C2), store availability (C3), native version consistency (C4), auto-detection peers (C7) and the Android staged-rollout note (C8).
- `checkVersion`: all arguments optional (omitted ones are detected), new `timeoutMs`.
- Android: a more robust version extraction from the Play page. More version formats are read (`5`, `1.0.0-beta.1`, `v2.1`), and an old version elsewhere on the page is no longer picked up by mistake.

### Breaking changes

- Requirements: React Native `>=0.73` and React `>=18` (peer dependencies; React 18 / 19 supported), TypeScript `>=5.0` in your app, Expo SDK `>=52`, Node.js `>=22.14` for the CLI.
- The package is ESM (`"type": "module"`) with an `exports` map. Only the root, `./texts/ja` and `./package.json` are exported; deep imports (`react-native-store-version/dist/...`) are no longer supported (they fail where `exports` is honored, and are internal where older tooling still resolves them). `dist/ios` / `dist/android` (`getIOSVersion` / `getAndroidVersion`) no longer exist.
- `compareVersion` follows compare-versions 6.1.1 (vendored) instead of 4.1.x: prerelease edge cases (`1.0.0-alpha` vs `1.0.0-alpha.0` is now `equal`) and versions with a leading `^` / `~` / `<` / `>` / `=` / `V` are now compared by their numbers.
- `checkVersion` on Android returns versions v1 rejected (`5`, `1.0.0-beta.1`, `v2.1`), so `remote` isn't limited to digits and dots. With omitted arguments it detects them instead of throwing; with a detected bundle ID on iOS the messages are `can't get ios version` (non-200 response, `results[0]` is null, or its `version` is not a string) and `appID(<bundleId>) is not released.`. `fetch` now receives a `signal`, and concurrent identical requests share one fetch. A `timeoutMs` expiry rejects with `StoreVersionError` (`code: 'TIMEOUT'`).
- The default export remains, but the named import `{ checkVersion }` is recommended.

### Planned

- `checkVersion` is planned to be updated in 2.1.0 to follow the rest of v2. This may include breaking changes.

## v1.4.2

- Changed the publish flow only (npm Trusted Publishing with provenance). No changes to the library code; no impact on users.

## v1.4.1

- fix `cannot read property "length" of undefined` on iOS by [magrinj](https://github.com/magrinj)
  - https://github.com/watanabeyu/react-native-store-version/pull/54

## v1.4.0

- Sorry for the long wait for an update.
- fix android.ts by [hussainimdad004](https://github.com/hussainimdad004)
  - https://github.com/watanabeyu/react-native-store-version/issues/39
- use prettier
- move example to [snack](https://snack.expo.dev/@watanabe_yu/react-native-store-version-example)

## v1.3.0

- if failed, throw an error.
- add result detail.
