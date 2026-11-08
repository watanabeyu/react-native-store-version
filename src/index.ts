import { Platform } from 'react-native';

import { getAndroidVersion } from './android.ts';
import { compareVersion, toDetail } from './compare.ts';
import { getIOSVersion } from './ios.ts';

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

export { compareVersion };

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
  const detail = toDetail(result);

  /* compare version */
  return <CheckVersionResponse>{
    local: params.version,
    remote: remoteVersion,
    result,
    detail,
  };
};

export default checkVersion;
