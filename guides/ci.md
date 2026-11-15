# CI check

[Back to README](../README.md)

Check the setup and the store lookup of your app in CI with the CLI or the GitHub Action.

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
