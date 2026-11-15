# `useStoreVersion` hook

[Back to README](../README.md)

Read the check result in your own components with `useStoreVersion`.

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
| `result`           | `'new' \| 'old' \| 'equal' \| null`                                  | Comparison, same values as the `result` of `checkVersion()`. Not affected by `policy`.                           |
| `detail`           | `'remote > local' \| 'remote < local' \| 'remote === local' \| null` | Same values as the `detail` of `checkVersion()`.                                                                 |
| `action`           | `'force' \| 'warning' \| 'none' \| null`                             | What the policy (and the minimum version) decided. The default UI follows this.                                  |
| `diff`             | `'major' \| 'minor' \| 'patch' \| null`                              | Kind of difference when `result === 'new'`.                                                                      |
| `dismissed`        | `boolean`                                                            | `action` is `warning` but "Later" was tapped.                                                                    |
| `local` / `remote` | `string \| null`                                                     | Current / latest version.                                                                                        |
| `storeUrl`         | `string \| null`                                                     | Store page URL. `null` on iOS while it is being looked up or if the lookup failed.                               |
| `releaseNotes`     | `string \| undefined`                                                | "What's new" of the current store version, on iOS and Android. `undefined` when `getLatestVersion` is used.      |
| `releaseDate`      | `string \| undefined`                                                | Release date of the current store version, ISO 8601 in UTC. `undefined` when `getLatestVersion` is used.         |
| `openStore()`      | `() => Promise<boolean>`                                             | Opens the store page. Resolves `true` if it opened, `false` otherwise (never rejects; failures go to `onError`). |
| `dismiss()`        | `() => void`                                                         | Closes the warning until the next launch (or a newer version).                                                   |
| `recheck()`        | `() => void`                                                         | Checks again. The previous result stays visible meanwhile and is restored if the recheck fails.                  |
| `error`            | `StoreVersionError \| null`                                          | Why the check failed (only when `status === 'error'`).                                                           |

During a recheck (`status: 'checking'`) the previous `result` / `action` remain, so a force modal never disappears while rechecking. Calling the hook outside the Provider throws.

`releaseNotes` (line breaks are `\n`) and `releaseDate` (to the second, for example `2026-11-05T22:49:03Z`) are also `undefined` when the store doesn't provide them; that never fails the check. The default UI shows them in the force card / warning sheet only when you pass [`showReleaseNotes`](../README.md#provider-props), and `onResult` doesn't receive them: read them from the hook or from the [`components`](./customizing-ui.md#2-components) props.
