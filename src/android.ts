const checkAndroid: checkPlatform = async (version: string, storeURL: string) => {
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
    result: version.split('.').some((v, i) => ((parseInt(v, 10) < parseInt(storeVersion[i], 10)))) ? 'new' : 'old',
  };
};

export default checkAndroid;
