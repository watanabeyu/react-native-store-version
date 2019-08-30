type checkResult = 'new' | 'old' | 'equal'

interface checkPlatformResponse {
  local: string,
  remote: string,
  result: checkResult,
}

interface checkPlatform {
  (version: string, storeURL: string, country?: string): Promise<checkPlatformResponse>
}

interface checkVersionParams {
  country?: string,
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
  ({
    country,
    version,
    iosStoreURL,
    androidStoreURL,
  }: checkVersionParams): Promise<checkVersionResponse | checkVersionResponseError>
}

declare module 'react-native-store-version' {
  const checkVersion: checkVersion;
  export default checkVersion;

  export const checkIOS: checkPlatform;
  export const checkAndroid: checkPlatform;
}
