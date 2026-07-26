import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const ALGORITHM = "scrypt";
const VERSION = "v1";
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const MAX_MEMORY = 32 * 1024 * 1024;

export const PASSWORD_HASH_PREFIX = `${ALGORITHM}:${VERSION}`;
export const DUMMY_PASSWORD_HASH = `${PASSWORD_HASH_PREFIX}:${COST}:${BLOCK_SIZE}:${PARALLELIZATION}:uYYJaoHBrXxi7mQ7X1g0JA:r4PMxIe2TJMzyMxsdQ3CEkgYqLTnkgu-MYOEdciEfkkOK3qwI7BKIifMfktevpoC3pr2mQdV2CJsTq2P8qU1xQ`;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

function encode(value: Buffer): string {
  return value.toString("base64url");
}

function decode(value: string): Buffer {
  if (!BASE64URL_PATTERN.test(value)) throw new Error("Invalid password hash encoding.");
  return Buffer.from(value, "base64url");
}

async function derive(password: string, salt: Buffer, cost: number, blockSize: number, parallelization: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, {
      N: cost,
      r: blockSize,
      p: parallelization,
      maxmem: MAX_MEMORY,
    }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await derive(password, salt, COST, BLOCK_SIZE, PARALLELIZATION);
  return `${PASSWORD_HASH_PREFIX}:${COST}:${BLOCK_SIZE}:${PARALLELIZATION}:${encode(salt)}:${encode(derived)}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(":");
  if (parts.length !== 7 || `${parts[0]}:${parts[1]}` !== PASSWORD_HASH_PREFIX) {
    await verifyDummy(password);
    return false;
  }

  const cost = Number(parts[2]);
  const blockSize = Number(parts[3]);
  const parallelization = Number(parts[4]);
  if (!Number.isInteger(cost) || !Number.isInteger(blockSize) || !Number.isInteger(parallelization)) {
    await verifyDummy(password);
    return false;
  }

  if (cost !== COST || blockSize !== BLOCK_SIZE || parallelization !== PARALLELIZATION) {
    await verifyDummy(password);
    return false;
  }

  try {
    const salt = decode(parts[5]);
    const expected = decode(parts[6]);
    if (salt.length !== SALT_LENGTH || expected.length !== KEY_LENGTH) {
      await verifyDummy(password);
      return false;
    }
    const actual = await derive(password, salt, cost, blockSize, parallelization);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    await verifyDummy(password);
    return false;
  }
}

async function verifyDummy(password: string): Promise<void> {
  const parts = DUMMY_PASSWORD_HASH.split(":");
  const salt = decode(parts[5]);
  await derive(password, salt, COST, BLOCK_SIZE, PARALLELIZATION);
}
