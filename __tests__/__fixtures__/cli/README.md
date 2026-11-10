# CLI fixtures

Minimal app layouts for the `check` CLI tests (C2 / C4 / C8). The tests copy a layout into a temporary directory
(outside this repository, so the package lookup from the app does not reach this repository's `node_modules`),
then add `package.json` and a fake `node_modules` (`react-native-store-version`, and for the Expo layouts a fake
`expo` whose `config.js` stands in for `expo/config`). Tests that need other shapes (several targets, `$(…)`,
`build.gradle.kts`, flavors, …) edit the copy.

There is no `package.json` here (it would collide in Jest's haste map) and no directory named `dist`, `build`,
`coverage` or `node_modules` (they are ignored by `.gitignore` or skipped by the scan). The sources are excluded from
`tsc` (`tsconfig.json`) and from Biome (`biome.json`): they are input for a text search, not code that runs.

| Layout | Expo config | `ios/` | `android/` | Expected |
|---|---|---|---|---|
| `expo-cng` | `app.json` (version `1.2.0`, `android.package`) + `app.config.js` (adds `ios.bundleIdentifier`) | none | none | C2: both IDs from the evaluated config (only the Android one from `app.json` when `expo/config` fails). C4: skipped (CNG). C8: warning (`App.tsx` has no `policy`) |
| `expo-native` | `app.json` (version `1.2.0`, both IDs) | app target + widget extension; Release `PRODUCT_BUNDLE_IDENTIFIER` differs from Debug; `MARKETING_VERSION = 1.0` but `Info.plist` has `1.2.0` | `applicationId 'com.example.native'`, `versionName "1.2.0"` | C2: both IDs from the native files. C4: ok (all `1.2.0`). C8: ok (`getMinimumVersion` is used) |
| `bare-rn` | none (`app.json` without `expo`) | unit-test target listed in the file before the app target; `Info.plist` has `$(MARKETING_VERSION)`, `MARKETING_VERSION = 2.0.1` | Groovy with braces and `applicationId` in comments / strings, `versionName "2.0.1"` | C2: both IDs from `project.pbxproj` / `build.gradle`. C4: ok (`2.0.1`). C8: warning (`src/App.jsx` has `'force'`) |
