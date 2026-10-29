import { useSyncExternalStore } from "react";
import { registryVersion, resolveAssetSrc, subscribeRegistry } from "./assetRegistry";

/** Resolve an element's content to an <img src>; re-renders when the asset finishes loading. */
export function useAssetSrc(content: string | null): string | null {
  useSyncExternalStore(subscribeRegistry, registryVersion);
  return content === null ? null : resolveAssetSrc(content);
}
