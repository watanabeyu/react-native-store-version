const checkIOS: checkPlatform = async (version: string, storeURL: string, country: string = 'jp') => {
  const appID = storeURL.match(/.+id([0-9]+)\??/);

  if (!appID) {
    throw new Error('iosStoreURL is invalid.');
  }

  const response = await fetch(`https://itunes.apple.com/lookup?id=${appID[1]}&country=${country}`)
    .then(r => r.text())
    .then(r => JSON.parse(r));

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
    result: version.split('.').some((v, i) => ((parseInt(v, 10) < parseInt(storeVersion[i], 10)))) ? 'new' : 'old',
  };
};

export default checkIOS;
