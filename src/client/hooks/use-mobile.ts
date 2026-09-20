import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 767px)";
const subscribe = (onStoreChange: () => void) => {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
};
const snapshot = () => window.matchMedia(QUERY).matches;
const serverSnapshot = () => false;
export const useIsMobile = () =>
  useSyncExternalStore(subscribe, snapshot, serverSnapshot);
