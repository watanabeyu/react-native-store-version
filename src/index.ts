import { Platform } from 'react-native';
import checkIOS from './ios';
import checkAndroid from './android';

const checkVersion: checkVersion = async (params) => {
  if (!params.version) {
    return {
      error: true,
      message: 'version is not set.',
    };
  }

  try {
    if (Platform.OS === 'ios') {
      if (params.iosStoreURL) {
        const result = await checkIOS(params.version, params.iosStoreURL, params.country || 'jp');

        return {
          error: false,
          ...result,
        };
      }

      return {
        error: true,
        message: 'iosStoreURL is not set.',
      };
    }

    if (Platform.OS === 'android') {
      if (params.androidStoreURL) {
        const result = await checkAndroid(params.version, params.androidStoreURL);

        return {
          error: false,
          ...result,
        };
      }

      return {
        error: true,
        message: 'androidStoreURL is not set.',
      };
    }
  } catch (e) {
    return {
      error: true,
      message: e.message,
    };
  }

  return {
    error: true,
    message: 'something error.',
  };
};

export default checkVersion;
