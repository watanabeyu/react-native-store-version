import { Platform } from 'react-native';
import compareVersions from 'compare-versions';
import getIOSVersion from './ios';
import getAndroidVersion from './android';

type CheckVersionParams = {
  country?: string;
  version: string;
  iosStoreURL?: string;
  androidStoreURL?: string;
}

type CheckVersionResponse = {
  local: string;
  remote: string;
  result: 'new' | 'old' | 'equal';
}

export const compareVersion = (local: string, remote: string): 'old' | 'new' | 'equal' => {
  switch (compareVersions(local, remote)) {
    case -1:
      return 'new';
    case 1:
      return 'old';
    default:
      return 'equal';
  }
};

const checkVersion = async (params: CheckVersionParams): Promise<CheckVersionResponse> => {
  if (!params.version) {
    throw new Error('local version is not set.');
  }

  /* check store url */
  if (Platform.OS === 'ios' && !params.iosStoreURL) {
    throw new Error('iosStoreURL is not set.');
  }

  if (Platform.OS === 'android' && !params.androidStoreURL) {
    throw new Error('androidStoreURL is not set.');
  }

  /* get version */
  let remoteVersion: string;

  try {
    remoteVersion = (Platform.OS === 'ios')
      ? await getIOSVersion(params.iosStoreURL, params.country || 'jp')
      : await getAndroidVersion(params.androidStoreURL);
  } catch (e) {
    throw new Error(e.message);
  }

  /* compare version */
  return <CheckVersionResponse>{
    error: false,
    local: params.version,
    remote: remoteVersion,
    result: compareVersion(params.version, remoteVersion),
  };
};

export default checkVersion;
