import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const scryptCost = 131_072
const scryptBlockSize = 8
const scryptParallelization = 1
const passwordHashLength = 64
const maxMemory = 256 * 1024 * 1024

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      passwordHashLength,
      {
        N: scryptCost,
        r: scryptBlockSize,
        p: scryptParallelization,
        maxmem: maxMemory,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error)
          return
        }
        resolve(derivedKey)
      },
    )
  })
}

export function isAcceptablePassword(password: string): boolean {
  const characterCount = [...password].length
  const byteCount = Buffer.byteLength(password, 'utf8')
  return characterCount >= 12 && characterCount <= 128 && byteCount <= 1024
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derivedKey = await deriveKey(password, salt)
  return [
    'scrypt',
    'v1',
    scryptCost,
    scryptBlockSize,
    scryptParallelization,
    salt.toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$')
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const [algorithm, version, costText, blockSizeText, parallelizationText, saltText, keyText, extra] =
    encodedHash.split('$')

  if (
    algorithm !== 'scrypt' ||
    version !== 'v1' ||
    costText !== String(scryptCost) ||
    blockSizeText !== String(scryptBlockSize) ||
    parallelizationText !== String(scryptParallelization) ||
    !saltText ||
    !keyText ||
    extra !== undefined
  ) {
    return false
  }

  const salt = Buffer.from(saltText, 'base64url')
  const expectedKey = Buffer.from(keyText, 'base64url')
  if (salt.length !== 16 || expectedKey.length !== passwordHashLength) {
    return false
  }

  const actualKey = await deriveKey(password, salt)
  return timingSafeEqual(actualKey, expectedKey)
}
