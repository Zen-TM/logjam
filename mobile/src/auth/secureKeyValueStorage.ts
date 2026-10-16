// expo-secure-store binding for the chunked key-value storage (Keychain on
// iOS, Keystore-encrypted prefs on Android), the token store Amplify is given
// in place of AsyncStorage (amplifyConfig.test.ts).
import * as SecureStore from "expo-secure-store";

import {
  createChunkedKeyValueStorage,
  toSecureStoreKey,
  type KeyValueBackend,
  type KeyValueStorage,
} from "./chunkedKeyValueStorage";

const secureStoreBackend: KeyValueBackend = {
  async get(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(toSecureStoreKey(key));
  },
  async set(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(toSecureStoreKey(key), value);
  },
  async remove(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(toSecureStoreKey(key));
  },
};

export const secureKeyValueStorage: KeyValueStorage =
  createChunkedKeyValueStorage(secureStoreBackend);
