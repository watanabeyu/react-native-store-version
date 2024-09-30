export const getIOSVersion = async (storeURL = '', country = 'jp') => {
  const appID = storeURL.match(/.+id([0-9]+)\??/);
  if (!appID) {
    throw new Error('iosStoreURL is invalid.');
  }

  const response = await fetch(
    `https://itunes.apple.com/lookup?id=${appID[1]}&country=${country}`,
    {
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
      },
    }
  );
  if (response.status !== 200) {
    throw new Error(
      `iTunes API returned an error with code: ${response.status}`
    );
  }

  const payload = await response.json();
  if (!payload || !payload.results || payload.results.length === 0) {
    throw new Error(`appID(${appID[1]}) is not released.`);
  }

  return payload.results[0].version as string;
};
