# Store fixtures

Responses taken from the real stores on 2026-11-08 and trimmed by hand-checked scripts (`rnsv-store-fixtures`).
They keep the real structure around the values the library reads. Long free text, URLs inside the Play data,
contact details and region-specific prices were replaced with `…`, and `nonce` values were emptied.
Every `AF_initDataCallback` `data` in the HTML fixtures is still valid JSON.

The hand-written fixtures one level up (`../itunes-lookup.json`, `../itunes-lookup-empty.json`, `../playstore.html`)
are used only by the v1 regression tests and are kept unchanged.

All requests: no cookies, User-Agent `okhttp/4.12.0` (what React Native's `fetch` sends on Android).

| File | Source | Original size | Kept | Expected result |
|---|---|---|---|---|
| `itunes-lookup.json` | `https://itunes.apple.com/lookup?bundleId=com.github.stormbreaker.prod&country=jp` | 9,797 B | Real wire format (3 leading / trailing newlines, `results[0]` on one line). Real values kept for `version`, `trackViewUrl` (with `?uo=4`, as the API returns it), `trackId`, `bundleId`, `artworkUrl512`, `currentVersionReleaseDate`, `minimumOsVersion`. `releaseNotes` keeps only its first line, `description` is `…`, arrays keep 1–2 items, rating / size keys are dropped | version `1.283.0` |
| `itunes-lookup-empty.json` | `https://itunes.apple.com/lookup?bundleId=com.example.rnsv.nonexistent&country=jp` | 42 B | Unchanged | `resultCount: 0`, `results: []` |
| `playstore.html` | `https://play.google.com/store/apps/details?id=com.github.android` | 1,259,356 B | (1) The JSON-LD script (`@type` kept; its `ratingValue` is a decoy number), (2) a decoy: two entries of the reviews block, placed before the version block, that hold older versions in `]]],"1.274.0",null,…` (every other string in them is `…` and every number is `0`, so the entries cannot be traced back to a review), (3) the `AF_initDataCallback` script that holds the version slot | version `1.283.0` in `[[["1.283.0"]],[[[37]],[[[26,"8.0"]]]]]` |
| `playstore-changed.html` | Same page as `playstore.html` | 1,259,356 B | Same as `playstore.html`, but the array that wraps the version is rewritten into a different, still well-formed shape (`{"v":["1.283.0"],"t":[[[37]],[[[26,"8.0"]]]]}`). The version string is still there | No pattern matches (structure change) |
| `playstore-varies.html` | `https://play.google.com/store/apps/details?id=com.google.android.apps.maps` | 1,343,471 B | Same blocks as `playstore.html` | Version slot is empty: `[[null,[]],[[[28,"9"]],[null,[]]]]`. The page has no "Varies with device" text |
| `playstore-nonnumeric.html` | `https://play.google.com/store/apps/details?id=org.wikipedia` | 1,294,016 B | Same blocks as `playstore.html` | Version slot holds a non-numeric versionName: `50616-r-2026-11-03` |

The Play block order (`ds:N`) and `hash` values change between requests, so nothing should depend on them.
On the real pages the reviews block comes before the version block in about half of the requests, which is why
the decoy is placed first: a pattern that only looks for a version-like number returns an older version.
