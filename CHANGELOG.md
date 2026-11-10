# CHANGELOG

## v2.0.0-beta.1

A rewrite. Drop in `<StoreVersionProvider>` and the app shows a force-update modal or a dismissible "update available" sheet on its own; the v1 `checkVersion()` / `compareVersion()` keep working. Still JavaScript only, now with **zero runtime dependencies**. See [MIGRATION.md](./MIGRATION.md) for upgrading and [README.md](./README.md) for the full guide.

### New

- `StoreVersionProvider`: checks the store on every launch without blocking rendering, reads the app version and ID automatically (`expo-application` or `react-native-device-info`, both optional), and never shows UI on failure (errors go to `onError`). Props: `policy`, `country`, `timeoutMs`, `recheckOnForeground`, `enabled`, `getLatestVersion`, `getMinimumVersion`, `onResult`, `onError`, `texts`, `icon`, `components`, `primaryColor`, `ui`, plus `version` / `bundleId` / `packageName` overrides.
- `useStoreVersion()`: `status`, `result` / `detail` (same values as v1), `action`, `diff`, `dismissed`, `local`, `remote`, `storeUrl`, `releaseNotes`, `openStore()`, `dismiss()`, `recheck()`, `error`. Usable anywhere under the Provider without extra requests.
- Default UI: a force card (not dismissible) and a warning bottom sheet ("Later" lasts until the next launch), light / dark, accessible, scrolls with large fonts. `policy` decides which one to show (default: force on major, warning on minor / patch; also `'force'` or a function).
- `texts` with `{remote}` / `{local}` placeholders, a Japanese preset at `react-native-store-version/texts/ja`, `icon`, `primaryColor`, and `components` to replace the card / sheet contents.
- `getLatestVersion` / `getMinimumVersion`: use Firebase Remote Config, a JSON file or your API instead of (or alongside) the store. A minimum version forces updates regardless of the policy.
- `StoreVersionError` with a `code` (`TIMEOUT`, `NETWORK`, `NOT_FOUND`, `PARSE_FAILED`, `INVALID_VERSION`, ...).
- CLI `react-native-store-version check` (Node 22.14+) and a GitHub Action (`uses: watanabeyu/react-native-store-version@v2` once 2.0.0 is released) that verify an app's setup: installation (C1), bundle ID / package detection (C2), store availability (C3), native version consistency (C4), auto-detection peers (C7) and the Android staged-rollout note (C8).
- `checkVersion`: all arguments optional (omitted ones are detected), new `timeoutMs`.
- Android: a more robust version extraction from the Play page. More version formats are read (`5`, `1.0.0-beta.1`, `v2.1`), and an old version elsewhere on the page is no longer picked up by mistake.

### Breaking changes

- Requirements: React Native `>=0.73` and React `>=18` (peer dependencies; React 18 / 19 supported), TypeScript `>=5.0` in your app, Expo SDK `>=52`, Node.js `>=22.14` for the CLI.
- The package is ESM (`"type": "module"`) with an `exports` map. Only the root, `./texts/ja` and `./package.json` are exported; deep imports (`react-native-store-version/dist/...`) are no longer supported (they fail where `exports` is honored, and are internal where older tooling still resolves them). `dist/ios` / `dist/android` (`getIOSVersion` / `getAndroidVersion`) no longer exist.
- `compareVersion` follows compare-versions 6.1.1 (vendored) instead of 4.1.x: prerelease edge cases (`1.0.0-alpha` vs `1.0.0-alpha.0` is now `equal`) and versions with a leading `^` / `~` / `<` / `>` / `=` / `V` are now compared by their numbers.
- `checkVersion` on Android returns versions v1 rejected (`5`, `1.0.0-beta.1`, `v2.1`), so `remote` isn't limited to digits and dots. With omitted arguments it detects them instead of throwing; with a detected bundle ID on iOS the messages are `can't get ios version` (non-200 response, `results[0]` is null, or its `version` is not a string) and `appID(<bundleId>) is not released.`. `fetch` now receives a `signal`, and concurrent identical requests share one fetch. A `timeoutMs` expiry rejects with `StoreVersionError` (`code: 'TIMEOUT'`).
- The default export remains, but the named import `{ checkVersion }` is recommended.

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
