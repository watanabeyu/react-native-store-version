import { Platform } from 'react-native';
import checkIOS from './ios';
import checkAndroid from './android';

const checkVersion: checkVersion = async ({ version, iosStoreURL, androidStoreURL }) => {
  if (!version) {
    return {
      error: true,
      message: 'version is not set.',
    };
  }

  try {
    if (Platform.OS === 'ios') {
      if (iosStoreURL) {
        const result = await checkIOS(version, iosStoreURL);

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
      if (androidStoreURL) {
        const result = await checkAndroid(version, androidStoreURL);

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
