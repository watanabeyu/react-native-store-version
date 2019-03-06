type checkResult = 'new' | 'old' | 'equal'

interface checkPlatformResponse {
  local: string,
  remote: string,
  result: checkResult,
}

interface checkPlatform {
  (version: string, storeURL: string): Promise<checkPlatformResponse>
}

interface checkVersionParams {
  version: string,
  iosStoreURL?: string,
  androidStoreURL?: string,
}

interface checkVersionResponse {
  local: string,
  remote: string,
  result: checkResult
}

interface checkVersionResponseError {
  error: boolean,
  message: string,
}

interface checkVersion {
  ({ version, iosStoreURL, androidStoreURL }: checkVersionParams): Promise<checkVersionResponse | checkVersionResponseError>
}
