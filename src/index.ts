import { Platform } from "react-native";
import compareVersions from "compare-versions";
import { getIOSVersion } from "./ios";
import { getAndroidUpdatedDate, getAndroidVersion } from "./android";

type CheckVersionParams = {
  country?: string;
  version: string;
  iosStoreURL?: string;
  androidStoreURL?: string;
};

type CheckVersionResponse = {
  local: string;
  remote: string;
  result: "new" | "old" | "equal";
  detail: "remote > local" | "remote < local" | "remote === local";
  updatedAt?: string;
};

export const compareVersion = (
  local: string,
  remote: string
): CheckVersionResponse["result"] => {
  switch (compareVersions(local, remote)) {
    case -1:
      return "new";
    case 1:
      return "old";
    default:
      return "equal";
  }
};

const checkVersion = async (
  params: CheckVersionParams
): Promise<CheckVersionResponse> => {
  if (!params.version) {
    throw new Error("local version is not set.");
  }

  /* check store url */
  if (Platform.OS === "ios" && !params.iosStoreURL) {
    throw new Error("iosStoreURL is not set.");
  }

  if (Platform.OS === "android" && !params.androidStoreURL) {
    throw new Error("androidStoreURL is not set.");
  }

  /* get version */
  let remoteVersion: string;

  /* get the date an android app was last updated */
  let updatedAt;

  try {
    remoteVersion =
      Platform.OS === "ios"
        ? await getIOSVersion(params.iosStoreURL, params.country || "jp")
        : await getAndroidVersion(params.androidStoreURL);
    updatedAt =
      Platform.OS === "ios"
        ? undefined
        : await getAndroidUpdatedDate(params.androidStoreURL);
  } catch (e) {
    throw new Error(e.message);
  }

  const result = compareVersion(params.version, remoteVersion);
  let detail: CheckVersionResponse["detail"];
  switch (result) {
    case "new":
      detail = "remote > local";
      break;
    case "old":
      detail = "remote < local";
      break;
    default:
      detail = "remote === local";
      break;
  }

  /* compare version */
  return <CheckVersionResponse>{
    local: params.version,
    remote: remoteVersion,
    result,
    detail,
    ...(updatedAt ? { updatedAt } : {}),
  };
};

export default checkVersion;
