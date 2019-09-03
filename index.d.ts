type CheckVersionParams = {
  country?: string;
  version: string;
  iosStoreURL?: string;
  androidStoreURL?: string;
}

type CheckVersionResponse = {
  error: boolean;
  local: string;
  remote: string;
  result: 'new' | 'old' | 'equal';
}

type CheckVersionResponseError = {
  error: boolean;
  message: string;
}

type CheckVersion = (params: CheckVersionParams) => Promise<CheckVersionResponse | CheckVersionResponseError>

declare module 'react-native-store-version' {
  const checkVersion: CheckVersion;
  export default checkVersion;
}
