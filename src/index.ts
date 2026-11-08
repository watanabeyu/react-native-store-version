// パッケージの入口。ここから export したものだけが公開 API になる
// （resolve / evaluatePolicy / request / fetcher / detect などの内部の関数は出さない。Provider / hook は Phase 3）
import { checkVersion } from './checkVersion.ts';

export type {
  CheckVersionParams,
  CheckVersionResponse,
} from './checkVersion.ts';
export type { CompareDetail, CompareResult, DiffType } from './compare.ts';
export { compareVersion } from './compare.ts';
export type { StoreVersionErrorCode } from './errors.ts';
export { StoreVersionError } from './errors.ts';
export type { VersionGetter, VersionGetterContext } from './fetchers/custom.ts';
export type { Action, Policy } from './policy.ts';
export { checkVersion };

// v1 互換の default export。MIGRATION では named import（`import { checkVersion } from ...`）を勧める（4.7）
export default checkVersion;
