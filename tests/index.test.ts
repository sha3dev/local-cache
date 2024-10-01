import assert from "assert";
import { test } from "node:test";
import LocalCache from "../src/index";

test("Should set and get a value correctly", async () => {
  const cache = new LocalCache();
  const key = "testKey";
  const value = "testValue";

  cache.set(key, value);
  const result = await cache.get(key);

  assert.strictEqual(
    result,
    value,
    "The retrieved value does not match the set value"
  );
});

test("Should respect TTL and expire the value after the specified time", async () => {
  const cache = new LocalCache({ defaultTTLMs: 100 });
  const key = "testKeyTTL";
  const value = "testValueTTL";

  cache.set(key, value);
  const resultBeforeTTL = await cache.get(key);
  assert.strictEqual(
    resultBeforeTTL,
    value,
    "The value should be available before expiration"
  );

  // Wait for TTL to expire
  await new Promise((resolve) => setTimeout(resolve, 150));
  const resultAfterTTL = await cache.get(key);
  assert.strictEqual(
    resultAfterTTL,
    null,
    "The value should have expired and be null"
  );
});

test("Should not store values when the cache is disabled", async () => {
  const cache = new LocalCache({ disabled: true });
  const key = "testKeyDisabled";
  const value = "testValueDisabled";

  cache.set(key, value);
  const result = await cache.get(key);

  assert.strictEqual(result, null, "The cache is disabled, should return null");
});

test("Should handle multiple values and respect the maximum limit", () => {
  const maxItems = 5;
  const cache = new LocalCache({ maxNumberOfCachedKeys: maxItems });

  // Fill the cache up to the limit
  for (let i = 0; i < maxItems; i++) {
    cache.set(`key${i}`, `value${i}`);
  }

  // Attempt to add one more item, which should throw an exception
  assert.throws(
    () => {
      cache.set(`key${maxItems}`, `value${maxItems}`);
    },
    /max/,
    "An exception should be thrown when the cache limit is exceeded"
  );
});

test("Should correctly handle key locking logic during concurrent calculations", async () => {
  const cache = new LocalCache();
  const key = "testKeyLock";
  const value = "testValueLock";

  // Function that simulates calculation and sets the value in the cache
  const calculateAndSetValue = async () => {
    // Simulate delay in calculation
    await new Promise((resolve) => setTimeout(resolve, 1000));
    cache.set(key, value);
  };

  // Start calculation without waiting for it to finish
  calculateAndSetValue();

  // Start multiple concurrent get requests for the same key
  const resultsPromise = Promise.all([
    cache.get(key, 2000),
    cache.get(key, 2000),
    cache.get(key, 2000),
  ]);

  // Wait for the get requests to complete
  const results = await resultsPromise;

  assert.strictEqual(results[0], null, "First value shoud be null");

  // Verify that all get requests receive the correct value
  for (let i = 1; i < results.length; i++) {
    assert.strictEqual(
      results[i],
      value,
      "All requests should receive the calculated value"
    );
  }

  // Make another get request; it should return the value immediately
  const immediateResult = await cache.get(key);
  assert.strictEqual(
    immediateResult,
    value,
    "Value should be returned immediately from the cache"
  );
});

test("Should correctly handle key locking timeout", async () => {
  const cache = new LocalCache();
  const key = "testKeyLock";
  const value = "testValueLock";

  // Function that simulates calculation and sets the value in the cache
  const calculateAndSetValue = async () => {
    // Simulate delay in calculation
    await new Promise((resolve) => setTimeout(resolve, 10000));
    cache.set(key, value);
  };

  // Start calculation without waiting for it to finish
  calculateAndSetValue();

  // Start multiple concurrent get requests for the same key
  const resultsPromise = Promise.all([
    cache.get(key, 2000),
    cache.get(key, 2000),
    cache.get(key, 2000),
  ]);

  // Wait for the get requests to complete
  const results = await resultsPromise;

  // Verify that all get requests receive the correct value
  for (let i = 0; i < results.length; i++) {
    assert.strictEqual(results[i], null, "All requests should return null");
  }
});
