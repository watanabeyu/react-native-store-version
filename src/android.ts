export const getAndroidVersion = async (storeURL: string = ''): Promise<string> => {
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

  return matches[1];
};
