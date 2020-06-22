const getIOSVersion = async (storeURL: string = '', country: string = 'jp'): Promise<string> => {
  const appID = storeURL.match(/.+id([0-9]+)\??/);

  if (!appID) {
    throw new Error('iosStoreURL is invalid.');
  }

  const response = await fetch(`https://itunes.apple.com/lookup?id=${appID[1]}&country=${country}`)
    .then((r) => r.text())
    .then((r) => JSON.parse(r));

  if (response.results.length === 0) {
    throw new Error(`appID(${appID[1]}) is not released.`);
  }

  return response.results[0].version;
};

export default getIOSVersion;
