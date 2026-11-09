// パッケージの入口。ここから export したものだけが公開 API になる
// （resolve / evaluatePolicy / request / fetcher / detect / openStore などの内部の関数と、Provider の Context は出さない）
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
export type {
  StoreVersionCheckResult,
  StoreVersionProviderProps,
} from './react/StoreVersionProvider.tsx';
export { StoreVersionProvider } from './react/StoreVersionProvider.tsx';
export type {
  StoreVersionForceTexts,
  StoreVersionResolvedTexts,
  StoreVersionTexts,
  StoreVersionWarningTexts,
} from './react/texts.ts';
export type {
  StoreVersionComponents,
  StoreVersionForceProps,
  StoreVersionStatus,
  StoreVersionWarningProps,
  UseStoreVersionResult,
} from './react/useStoreVersion.ts';
export { useStoreVersion } from './react/useStoreVersion.ts';
export { checkVersion };

// v1 互換の default export。MIGRATION では named import（`import { checkVersion } from ...`）を勧める（4.7）
export default checkVersion;
