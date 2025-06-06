/**
 * LocalCache
 */

/**
 * imports: externals
 */

import Logger from "@sha3/logger";
import fs from "fs";
import path from "path";
import os from "os";

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

export type LocalCacheMode = "memory" | "disk";

export type LocalCacheOptions = {
  disabled?: boolean;
  defaultTtlMs?: number;
  cleanCacheIntervalMs?: number;
  maxNumberOfCachedKeys?: number;
  mode?: LocalCacheMode;
  diskStoragePath?: string;
};

export type LocalCacheItem = {
  value: unknown;
  expiredOn: number;
};

/**
 * consts
 */

const MAX_NUMBER_OF_CACHED_KEYS = 10000;

const DEFAULT_TTL_MS = 5000;

const DEFAULT_CLEAN_CACHE_INTERVAL_MS = 30000;

/**
 * exports
 */

export default class LocalCache {
  /**
   * private: attributes
   */

  private mode: LocalCacheMode;

  private ttlMs: number;

  private cache = new Map<string, LocalCacheItem>();

  private lockCallbacks: Record<string, ((value: unknown) => void)[]> = {};
  
  private diskStoragePath: string = "";

  /**
   * private: methods
   */

  private size = () => {
    if (this.mode === "memory") {
      return this.cache.size;
    } else if (this.mode === "disk") {
      try {
        if (fs.existsSync(this.diskStoragePath)) {
          return fs.readdirSync(this.diskStoragePath).length;
        }
      } catch (error) {
        logger.error(`Failed to get disk storage size: ${error}`);
      }
      return 0;
    }
    return 0;
  };

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
      if (this.mode === "memory") {
        const cacheItem = this.cache.get(key);
        if (cacheItem?.value && cacheItem.expiredOn > Date.now()) {
          return cacheItem.value as T;
        }
      } else if (this.mode === "disk") {
        const cacheItem = this.getFromDisk(key);
        if (cacheItem?.value && cacheItem.expiredOn > Date.now()) {
          return cacheItem.value as T;
        }
      }
    }
    return null;
  }

  private ensureDiskStorageDirectory() {
    if (!fs.existsSync(this.diskStoragePath)) {
      fs.mkdirSync(this.diskStoragePath, { recursive: true });
      logger.debug(`Created disk storage directory: ${this.diskStoragePath}`);
    }
  }

  private getFilePath(key: string): string {
    // Create a safe filename from the key
    const safeKey = Buffer.from(key).toString('base64');
    return path.join(this.diskStoragePath, `${safeKey}.json`);
  }

  private saveToDisk(key: string, item: LocalCacheItem) {
    try {
      this.ensureDiskStorageDirectory();
      const filePath = this.getFilePath(key);
      fs.writeFileSync(filePath, JSON.stringify(item), 'utf8');
      logger.debug(`Saved ${key} to disk at ${filePath}`);
    } catch (error) {
      logger.error(`Failed to save ${key} to disk: ${error}`);
    }
  }

  private getFromDisk(key: string): LocalCacheItem | null {
    try {
      const filePath = this.getFilePath(key);
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf8');
        const item = JSON.parse(data) as LocalCacheItem;
        return item;
      }
    } catch (error) {
      logger.error(`Failed to read ${key} from disk: ${error}`);
    }
    return null;
  }

  private deleteFromDisk(key: string): boolean {
    try {
      const filePath = this.getFilePath(key);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.debug(`Deleted ${key} from disk at ${filePath}`);
        return true;
      }
    } catch (error) {
      logger.error(`Failed to delete ${key} from disk: ${error}`);
    }
    return false;
  }

  private cleanDiskStorage() {
    try {
      if (!fs.existsSync(this.diskStoragePath)) return;
      
      const now = Date.now();
      let cleanCount = 0;
      
      const files = fs.readdirSync(this.diskStoragePath);
      for (const file of files) {
        try {
          const filePath = path.join(this.diskStoragePath, file);
          const data = fs.readFileSync(filePath, 'utf8');
          const item = JSON.parse(data) as LocalCacheItem;
          
          if (item.expiredOn <= now) {
            fs.unlinkSync(filePath);
            cleanCount++;
          }
        } catch (error) {
          logger.error(`Error processing file ${file}: ${error}`);
        }
      }
      
      if (cleanCount) {
        logger.debug(`Cleared ${cleanCount} keys from disk storage`);
      }
    } catch (error) {
      logger.error(`Failed to clean disk storage: ${error}`);
    }
  }

  /**
   * constructor
   */

  constructor(private options?: LocalCacheOptions) {
    this.mode = options?.mode || "memory";
    
    // Set TTL based on mode - infinite for disk mode if not specified
    if (this.mode === "disk" && options?.defaultTtlMs === undefined) {
      this.ttlMs = Number.MAX_SAFE_INTEGER; // Effectively infinite TTL
    } else {
      this.ttlMs = options?.defaultTtlMs || DEFAULT_TTL_MS;
    }
    
    // Set up disk storage path if in disk mode
    if (this.mode === "disk") {
      this.diskStoragePath = options?.diskStoragePath || path.join(os.tmpdir(), 'local-cache-storage');
      this.ensureDiskStorageDirectory();
      const ttlDisplay = this.ttlMs === Number.MAX_SAFE_INTEGER ? "infinite" : this.ttlMs;
      logger.debug(`Created local-cache in disk mode, path: ${this.diskStoragePath}, ttl: ${ttlDisplay}`);
    } else {
      logger.debug(`Created local-cache in memory mode, ttl: ${this.ttlMs}`);
    }
    
    const cleanCacheIntervalMs =
      options?.cleanCacheIntervalMs || DEFAULT_CLEAN_CACHE_INTERVAL_MS;
    
    // Set up cleaning interval based on mode
    if (this.mode === "disk") {
      setInterval(() => this.cleanDiskStorage(), cleanCacheIntervalMs);
    } else {
      setInterval(this.clear, cleanCacheIntervalMs);
    }
  }

  /**
   * public: methods
   */

  public set(key: string, value: unknown, ttlMs?: number) {
    const maxNumberOfCachedKeys =
      this.options?.maxNumberOfCachedKeys || MAX_NUMBER_OF_CACHED_KEYS;
    if (!this.options?.disabled) {
      if (!maxNumberOfCachedKeys || this.size() < maxNumberOfCachedKeys) {
        // Use provided TTL or default TTL based on mode
        let effectiveTtl = ttlMs;
        if (effectiveTtl === undefined) {
          effectiveTtl = this.ttlMs;
        }
        
        const expiredOn = Date.now() + effectiveTtl;
        const cacheItem: LocalCacheItem = { value, expiredOn };
        
        // Format TTL for logging
        const ttlDisplay = effectiveTtl === Number.MAX_SAFE_INTEGER ? "infinite" : effectiveTtl;
        logger.debug(`set ${key} (ttl: ${ttlDisplay}, mode: ${this.mode})`);
        
        if (this.mode === "memory") {
          this.cache.set(key, cacheItem);
        } else if (this.mode === "disk") {
          this.saveToDisk(key, cacheItem);
        }
        
        this.unlockKey(key, value);
      } else {
        throw new Error(
          `local-cache max limit reach (${maxNumberOfCachedKeys})`
        );
      }
    }
  }

  public delete(key: string) {
    if (!this.options?.disabled) {
      logger.debug(`delete ${key} (mode: ${this.mode})`);
      
      if (this.mode === "memory") {
        return this.cache.delete(key);
      } else if (this.mode === "disk") {
        return this.deleteFromDisk(key);
      }
    }
    return false;
  }

  public async get<T>(
    key: string,
    waitIfSetInProcessMs?: number
  ): Promise<T | null> {
    if (this.options?.disabled) {
      return null;
    }
    return new Promise((resolve) => {
      const result = this.getSync<T>(key);
      if (result) {
        logger.debug(`retrieved ${key} from cache`);
        resolve(result);
      } else if (waitIfSetInProcessMs) {
        if (!this.lockCallbacks[key]) {
          this.lockCallbacks[key] = [];
          resolve(result);
        } else {
          setTimeout(() => {
            if (this.lockCallbacks[key]?.includes(resolve)) {
              this.lockCallbacks[key] = this.lockCallbacks[key].filter(
                (i) => i !== resolve
              );
              resolve(null);
            }
          }, waitIfSetInProcessMs);
          this.lockCallbacks[key].push(resolve);
        }
      } else {
        resolve(null);
      }
    });
  }
}
