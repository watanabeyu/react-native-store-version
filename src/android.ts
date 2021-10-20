export const findOnAndroidPage = async (
  storeURL: string = "",
  matcher: {
    [Symbol.match](string: string): RegExpMatchArray | null;
  }
): Promise<string> => {
  if (
    !storeURL.match(
      /^https?:\/\/play\.google\.com\/store\/apps\/details\?id=[0-9a-zA-Z.]+/
    )
  ) {
    throw new Error("androidStoreURL is invalid.");
  }

  const response = await fetch(storeURL).then((r) => {
    if (r.status === 200) {
      return r.text();
    }

    throw new Error("androidStoreURL is invalid.");
  });

  const matches = response.match(matcher);

  if (!matches) {
    throw new Error("can't get matching android information.");
  }

  return matches[1];
};

export const getAndroidVersion = async (
  storeURL: string = ""
): Promise<string> => {
  const androidAppVersionMatcher =
    /<span class="htlgb"><div class="IQ1z0d"><span class="htlgb">([0-9]+\.?[0-9]*\.?[0-9]*)<\/span><\/div><\/span>/;

  const androidAppVerion = await findOnAndroidPage(
    storeURL,
    androidAppVersionMatcher
  );

  return androidAppVerion;
};

export const getAndroidUpdatedDate = async (
  storeURL: string = ""
): Promise<string> => {
  const androidAppUpdatedDateMatcher =
    /<span class="htlgb"><div class="IQ1z0d"><span class="htlgb">([A-Z][a-z]+ [0-9]{1,2}, [0-9]{4})<\/span><\/div><\/span>/;

  const androidAppUpdatedDate = await findOnAndroidPage(
    storeURL,
    androidAppUpdatedDateMatcher
  );

  return androidAppUpdatedDate;
};
