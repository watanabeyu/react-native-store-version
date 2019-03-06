type checkResult = 'new' | 'old' | 'equal'

declare interface checkPlatformResponse {
  local: string,
  remote: string,
  result: checkResult,
}

declare interface checkPlatform {
  (version: string, storeURL: string): Promise<checkPlatformResponse>
}

declare interface checkVersionParams {
  version: string,
  iosStoreURL?: string,
  androidStoreURL?: string,
}

declare interface checkVersionResponse {
  local: string,
  remote: string,
  result: checkResult
}

declare interface checkVersionResponseError {
  error: boolean,
  message: string,
}

declare interface checkVersion {
  ({ version, iosStoreURL, androidStoreURL }: checkVersionParams): Promise<checkVersionResponse | checkVersionResponseError>
}
