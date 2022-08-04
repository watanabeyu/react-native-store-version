import compareVersions from 'compare-versions';
import { Platform } from 'react-native';

import { getAndroidVersion } from './android';
import { getIOSVersion } from './ios';

type CheckVersionParams = {
  country?: string;
  version: string;
  iosStoreURL?: string;
  androidStoreURL?: string;
};

type CheckVersionResponse = {
  local: string;
  remote: string;
  result: 'new' | 'old' | 'equal';
  detail: 'remote > local' | 'remote < local' | 'remote === local';
};

export const compareVersion = (
  local: string,
  remote: string
): CheckVersionResponse['result'] => {
  switch (compareVersions(local, remote)) {
    case -1:
      return 'new';
    case 1:
      return 'old';
    default:
      return 'equal';
  }
};

const checkVersion = async (
  params: CheckVersionParams
): Promise<CheckVersionResponse> => {
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
    remoteVersion =
      Platform.OS === 'ios'
        ? await getIOSVersion(params.iosStoreURL, params.country || 'jp')
        : await getAndroidVersion(params.androidStoreURL);
  } catch (e) {
    if (e instanceof Error) {
      throw new Error(e.message);
    }

    throw new Error(`can't get ${Platform.OS} version`);
  }

  const result = compareVersion(params.version, remoteVersion);
  let detail: CheckVersionResponse['detail'];
  switch (result) {
    case 'new':
      detail = 'remote > local';
      break;
    case 'old':
      detail = 'remote < local';
      break;
    default:
      detail = 'remote === local';
      break;
  }

  /* compare version */
  return <CheckVersionResponse>{
    local: params.version,
    remote: remoteVersion,
    result,
    detail,
  };
};

export default checkVersion;
