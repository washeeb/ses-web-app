import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

type ScryptOpts = { N: number; r: number; p: number; maxmem: number };

const scrypt = (password: string, salt: Buffer, keylen: number, opts: ScryptOpts) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );

const KEYLEN = 64;

function logN() {
  // Tests lower the cost factor; production uses 2^15.
  return Number(process.env.SCRYPT_LOG_N ?? 15);
}

/** Format: scrypt$<logN>$<r>$<p>$<salt>$<hash> */
export async function hashPassword(password: string): Promise<string> {
  const ln = logN();
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N: 2 ** ln, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  return ["scrypt", ln, 8, 1, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, ln, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !ln || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await scrypt(password, Buffer.from(salt, "base64"), expected.length, {
    N: 2 ** Number(ln),
    r: Number(r),
    p: Number(p),
    maxmem: 128 * 1024 * 1024,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export const PASSWORD_MIN_LENGTH = 12;

export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > 200) return "Password is too long.";
  if (/^(.)\1+$/.test(password)) return "Password is too simple.";
  return null;
}
