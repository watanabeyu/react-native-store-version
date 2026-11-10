export const getMinimumVersion = async () => {
  const response = await fetch('https://example.com/minimum-version.json');
  const { version } = (await response.json()) as { version: string };
  return version;
};
