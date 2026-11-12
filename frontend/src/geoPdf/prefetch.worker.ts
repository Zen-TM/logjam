// The prefetch worker's entry. The client ends it to stop it.
import { prefetchTiles } from "./prefetch";
import type { GeoPdfRenderInput } from "./types";

const scope = self as unknown as {
  postMessage(message: unknown): void;
  onmessage: ((e: MessageEvent<{ input: GeoPdfRenderInput }>) => void) | null;
};

scope.onmessage = async (e) => {
  await prefetchTiles(e.data.input, new AbortController().signal);
  scope.postMessage("done");
};
