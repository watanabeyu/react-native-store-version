# Your own version source

[Back to README](../README.md)

Return the latest and / or the minimum version from your own source.

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

## A static JSON file (GitHub Pages, S3, a CDN, ...)

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

## Your own API

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

## Firebase Remote Config (`@react-native-firebase/remote-config`)

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
