type checkResult = 'new' | 'old' | 'equal'

export interface checkPlatformResponse {
  local: string,
  remote: string,
  result: checkResult,
}

export interface checkPlatform {
  (version: string, storeURL: string): Promise<checkPlatformResponse>
}

export interface checkVersionParams {
  version: string,
  iosStoreURL?: string,
  androidStoreURL?: string,
}

export interface checkVersionResponse {
  local: string,
  remote: string,
  result: checkResult
}

export interface checkVersionResponseError {
  error: boolean,
  message: string,
}

export interface checkVersion {
  ({ version, iosStoreURL, androidStoreURL }: checkVersionParams): Promise<checkVersionResponse | checkVersionResponseError>
}
