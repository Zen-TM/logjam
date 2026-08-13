// First-launch installer for the bundled glyph/sprite assets (stage 4a §8.3).
//
// assets/basemap/basemap-assets.zip (vendored by scripts/basemap/fetch-assets.sh,
// pinned to a protomaps/basemaps-assets commit) is extracted once into
// <documentDirectory>/basemap-assets/ so the map style can reference stable
// file:// URLs — asset:// URLs behave differently per platform, and MapLibre
// needs plain files it can read directly. A version marker (the vendored
// commit hash) makes re-extraction happen exactly when the pin changes.
//
// documentDirectory is app-private and covered by allowBackup=false, matching
// the storage posture of the offline registry.
import { useEffect, useState } from "react";
import { Asset } from "expo-asset";
import { unzipSync } from "fflate";
import { Directory, File } from "expo-file-system/next";

import { BASEMAP_ASSETS_DIR } from "../../offline/localStores";

import { BASEMAP_ASSETS_COMMIT } from "./basemapAssetsVersion";

const VERSION_MARKER_NAME = ".version";

async function installBasemapAssets(): Promise<string> {
  const root = new Directory(BASEMAP_ASSETS_DIR);
  const marker = new File(root, VERSION_MARKER_NAME);
  if (marker.exists && marker.text() === BASEMAP_ASSETS_COMMIT) {
    return root.uri;
  }

  // Stale pin or partial extract (marker is written last) — wipe and redo.
  if (root.exists) root.delete();
  root.create({ intermediates: true });

  // Dev-client: downloadAsync fetches the zip from Metro once; release
  // builds bundle it in the APK/IPA and this resolves locally.
  const zipAsset = Asset.fromModule(
    require("../../../assets/basemap/basemap-assets.zip"),
  );
  await zipAsset.downloadAsync();
  if (!zipAsset.localUri) {
    throw new Error("basemap-assets.zip missing localUri after downloadAsync");
  }

  const entries = unzipSync(new File(zipAsset.localUri).bytes());
  const filePaths = Object.keys(entries).filter((p) => !p.endsWith("/"));

  // Parents first (create is not recursive across missing intermediates
  // unless asked; sorting keeps fonts/ before fonts/<stack>/).
  const parentDirs = new Set<string>();
  for (const p of filePaths) {
    const slash = p.lastIndexOf("/");
    if (slash > 0) parentDirs.add(p.slice(0, slash));
  }
  for (const dirPath of [...parentDirs].sort()) {
    const dir = new Directory(root, dirPath);
    if (!dir.exists) dir.create({ intermediates: true });
  }
  for (const p of filePaths) {
    new File(root, p).write(entries[p]);
  }

  marker.write(BASEMAP_ASSETS_COMMIT);
  return root.uri;
}

// One install per JS session; a failure clears the memo so a later mount
// retries instead of caching the error forever.
let installPromise: Promise<string> | null = null;

export function ensureBasemapAssets(): Promise<string> {
  if (!installPromise) {
    installPromise = installBasemapAssets().catch((err) => {
      installPromise = null;
      throw err;
    });
  }
  return installPromise;
}

export type BasemapAssetsState = {
  /** file:// base URL once installed; null while installing or after failure. */
  localBaseUrl: string | null;
  /** True when install failed — callers fall back to the remote asset host. */
  failed: boolean;
};

export function useBasemapAssets(): BasemapAssetsState {
  const [state, setState] = useState<BasemapAssetsState>({
    localBaseUrl: null,
    failed: false,
  });
  useEffect(() => {
    let alive = true;
    ensureBasemapAssets().then(
      (uri) => {
        if (alive) setState({ localBaseUrl: uri, failed: false });
      },
      (err) => {
        // Fail loud (Sentry picks up console.error) but keep the map usable
        // online via the remote glyph/sprite host.
        console.error("basemap asset install failed", err);
        if (alive) setState({ localBaseUrl: null, failed: true });
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
