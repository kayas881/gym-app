import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Token cache implementation for Clerk using expo-secure-store.
 * Persists auth tokens so users don't need to re-login on app restart.
 * Falls back to no caching on web (SecureStore is native-only).
 */

export interface TokenCacheInterface {
  getToken: (key: string) => Promise<string | null>;
  saveToken: (key: string, token: string) => Promise<void>;
  clearToken?: (key: string) => Promise<void>;
}

const createTokenCache = (): TokenCacheInterface => {
  return {
    getToken: async (key: string) => {
      try {
        const item = await SecureStore.getItemAsync(key);
        return item;
      } catch (error) {
        console.error(`[TokenCache] Error getting token for key: ${key}`, error);
        await SecureStore.deleteItemAsync(key);
        return null;
      }
    },
    saveToken: async (key: string, token: string) => {
      try {
        await SecureStore.setItemAsync(key, token);
      } catch (error) {
        console.error(`[TokenCache] Error saving token for key: ${key}`, error);
      }
    },
    clearToken: async (key: string) => {
      try {
        await SecureStore.deleteItemAsync(key);
      } catch (error) {
        console.error(`[TokenCache] Error clearing token for key: ${key}`, error);
      }
    },
  };
};

// Only use SecureStore on native platforms
export const tokenCache = Platform.OS !== 'web' ? createTokenCache() : undefined;
