import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Auth tokens go through expo-secure-store (Keychain/Keystore), never
 * AsyncStorage (rules/mobile.md — non-negotiable on iOS/Android). The `web`
 * platform branch below exists ONLY so this app's screens can be verified
 * in a browser during development (there is no simulator in this build
 * environment) — expo-secure-store has no real secure backing on web, so
 * this branch is explicitly NOT the production security boundary. Shipped
 * builds are iOS/Android only, where the SecureStore branch is what runs.
 */
const memoryFallback = new Map<string, string>();

export async function setSecureItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    memoryFallback.set(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function getSecureItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return memoryFallback.get(key) ?? null;
  }
  return SecureStore.getItemAsync(key);
}

export async function deleteSecureItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    memoryFallback.delete(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
