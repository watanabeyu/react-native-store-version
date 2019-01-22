import { Platform } from 'react-native';

const checkIOS = async (version = null, storeURL = null) => {
  const appID = storeURL.match(/.+id([0-9]+)\?/);

  if (!appID) {
    throw new Error('iosStoreURL is invalid.');
  }

  const response = await fetch(`https://itunes.apple.com/jp/lookup?id=${appID[1]}`).then(r => r.text()).then(r => JSON.parse(r));

  if (response.results.length === 0) {
    throw new Error(`appID(${appID[1]}) is not released.`);
  }

  const storeVersion = response.results[0].version.split('.');

  if (version === response.results[0].version) {
    return {
      local: version,
      remote: response.results[0].version,
      result: 'equal',
    };
  }

  return {
    local: version,
    remote: response.results[0].version,
    result: version.split('.').some((v, i) => ((parseInt(v, 10) < storeVersion[i]))) ? 'new' : 'old',
  };
};

const checkAndroid = async (version = null, storeURL = null) => {
  if (!storeURL.match(/^https?:\/\/play\.google\.com\/store\/apps\/details\?id=[0-9a-zA-Z.]+/)) {
    throw new Error('androidStoreURL is invalid.');
  }

  const response = await fetch(storeURL).then((r) => {
    if (r.status === 200) {
      return r.text();
    }

    throw new Error('androidStoreURL is invalid.');
  });

  const matches = response.match(/<span class="htlgb"><div class="IQ1z0d"><span class="htlgb">([0-9]+\.?[0-9]*\.?[0-9]*)<\/span><\/div><\/span>/);

  if (!matches) {
    throw new Error('can\'t get android app version.');
  }

  const storeVersion = matches[1].split('.');

  if (version === matches[1]) {
    return {
      local: version,
      remote: matches[1],
      result: 'equal',
    };
  }

  return {
    local: version,
    remote: matches[1],
    result: version.split('.').some((v, i) => ((parseInt(v, 10) < storeVersion[i]))) ? 'new' : 'old',
  };
};

const checkVersion = async ({ version = null, iosStoreURL = null, androidStoreURL = null }) => {
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
