export const getIOSVersion = async (storeURL = '', country = 'jp') => {
  const appID = storeURL.match(/.+id([0-9]+)\??/);

  if (!appID) {
    throw new Error('iosStoreURL is invalid.');
  }

  const response = await fetch(
    `https://itunes.apple.com/lookup?id=${
      appID[1]
    }&country=${country}&${new Date().getTime()}`,
    {
      headers: {
        'cache-control': 'no-cache',
      },
    }
  )
    .then((r) => r.text())
    .then((r) => JSON.parse(r));

  if (!response || !response.results || response.results.length === 0) {
    throw new Error(`appID(${appID[1]}) is not released.`);
  }

  return response.results[0].version as string;
};
