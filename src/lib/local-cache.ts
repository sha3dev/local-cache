/**
 * LocalCache
 */

/**
 * imports: externals
 */

import Logger from "@sha3/logger";

/**
 * imports: internals
 */

/**
 * module: initializations
 */

const logger = new Logger("local-cache");

/**
 * types
 */

export type LocalCacheOptions = {
  disabled?: boolean;
  defaultTTLMs?: number;
  cleanCacheIntervalMs?: number;
  maxNumberOfCachedKeys?: number;
};

export type LocalCacheItem = {
  value: unknown;
  expiredOn: number;
};

/**
 * consts
 */

const DEFAULT_TTL_MS = 5000;

const DEFAULT_CLEAN_CACHE_INTERVAL_MS = 30000;

/**
 * exports
 */

export default class {
  /**
   * private: attributes
   */

  private ttl: number = DEFAULT_TTL_MS;

  private cache = new Map<string, LocalCacheItem>();

  private lockCallbacks: Record<string, ((value: unknown) => void)[]> = {};

  /**
   * private: methods
   */

  private size = () => this.cache.size;

  private clear = () => {
    const now = Date.now();
    let cleanCount = 0;
    this.cache.forEach((entry, key) => {
      if (!this.lockCallbacks[key]) {
        if (entry?.expiredOn <= now) {
          cleanCount += 1;
          this.cache.delete(key);
        }
      }
    });
    if (cleanCount) {
      logger.debug(
        `cleared ${cleanCount} keys from local-cache (current keys: ${this.size()})`
      );
    }
  };

  private unlockKey(key: string, value: unknown) {
    if (this.lockCallbacks[key]) {
      const callbacks = this.lockCallbacks[key];
      callbacks.forEach((i) => {
        logger.debug(`retrieved ${key} from cache (after locking)`);
        i(value);
      });
      delete this.lockCallbacks[key];
    }
  }

  private getSync<T>(key: string) {
    if (!this.options?.disabled) {
      const cacheItem = this.cache.get(key);
      if (cacheItem?.value && cacheItem.expiredOn > Date.now()) {
        return cacheItem.value as T;
      }
    }
    return null;
  }

  /**
   * constructor
   */

  constructor(private options?: LocalCacheOptions) {
    this.ttl = options?.defaultTTLMs || DEFAULT_TTL_MS;
    logger.debug(`created local-cache, ttl: ${this.ttl}`);
    const cleanCacheIntervalMs =
      options?.cleanCacheIntervalMs || DEFAULT_CLEAN_CACHE_INTERVAL_MS;
    setInterval(this.clear, cleanCacheIntervalMs);
  }

  /**
   * public: methods
   */

  public set(key: string, value: unknown, ttl?: number) {
    const maxNumberOfCachedKeys = this.options?.maxNumberOfCachedKeys;
    if (!this.options?.disabled) {
      if (!maxNumberOfCachedKeys || this.size() < maxNumberOfCachedKeys) {
        const effectiveTtl = ttl || this.ttl;
        const expiredOn = Date.now() + effectiveTtl;
        logger.debug(`set ${key} (ttl: ${effectiveTtl})`);
        this.cache.set(key, { value, expiredOn });
        this.unlockKey(key, value);
      } else {
        throw new Error(
          `local-cache max limit reach (${maxNumberOfCachedKeys})`
        );
      }
    }
  }

  public async get<T>(
    key: string,
    waitIfSetInProcess?: boolean
  ): Promise<T | null> {
    if (this.options?.disabled) {
      return null;
    }
    return new Promise((resolve) => {
      const result = this.getSync<T>(key);
      if (result) {
        logger.debug(`retrieved ${key} from cache`);
        resolve(result);
      } else if (waitIfSetInProcess) {
        if (!this.lockCallbacks[key]) {
          this.lockCallbacks[key] = [];
          resolve(result);
        } else {
          this.lockCallbacks[key].push(resolve);
        }
      } else {
        resolve(null);
      }
    });
  }
}
