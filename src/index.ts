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

const checkVersion: checkVersion = async (params) => {
  if (!params.version) {
    return <checkVersionResponseError>{
      error: true,
      message: 'local version is not set.',
    };
  }

  /* check store url */
  if (Platform.OS === 'ios' && !params.iosStoreURL) {
    return <checkVersionResponseError>{
      error: true,
      message: 'iosStoreURL is not set.',
    };
  }

  if (Platform.OS === 'android' && !params.androidStoreURL) {
    return <checkVersionResponseError>{
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
    return <checkVersionResponseError>{
      error: true,
      message: e.message,
    };
  }

  /* compare version */
  return <checkVersionResponse>{
    error: false,
    local: params.version,
    remote: remoteVersion,
    result: compareVersion(params.version, remoteVersion),
  };
};

export default checkVersion;
