import { Platform } from 'react-native';
import compareVersions from 'compare-versions';
import getIOSVersion from './ios';
import getAndroidVersion from './android';

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

const checkVersion: CheckVersion = async (params) => {
  if (!params.version) {
    return <CheckVersionResponseError>{
      error: true,
      message: 'local version is not set.',
    };
  }

  /* check store url */
  if (Platform.OS === 'ios' && !params.iosStoreURL) {
    return <CheckVersionResponseError>{
      error: true,
      message: 'iosStoreURL is not set.',
    };
  }

  if (Platform.OS === 'android' && !params.androidStoreURL) {
    return <CheckVersionResponseError>{
      error: true,
      message: 'androidStoreURL is not set.',
    };
  }

  /* get version */
  let remoteVersion: string;

  try {
    remoteVersion = (Platform.OS === 'ios')
      ? await getIOSVersion(params.iosStoreURL, params.country || 'jp')
      : await getAndroidVersion(params.androidStoreURL);
  } catch (e) {
    return <CheckVersionResponseError>{
      error: true,
      message: e.message,
    };
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
