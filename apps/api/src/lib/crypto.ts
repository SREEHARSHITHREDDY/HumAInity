/* ═══════════════════════════════════════════════════════════════════════════
 *  FIELD ENCRYPTION FOR THE RESTRICTED ZONE
 *
 *  Separating the health database from the HR database stops the application
 *  from leaking. It does not stop someone who obtains the file — a stolen
 *  laptop, a misconfigured backup, a careless copy onto a shared drive. For
 *  clinical data that is not an acceptable gap, so the sensitive columns are
 *  encrypted before they are written.
 *
 *  AES-256-GCM, which is authenticated: tampering with the ciphertext is
 *  detected on read rather than producing plausible rubbish.
 *
 *  The stored format is self-describing:
 *      v1:<iv base64>:<auth tag base64>:<ciphertext base64>
 *  so a later key rotation or algorithm change can recognise what it is
 *  looking at instead of guessing.
 *
 *  What is NOT encrypted, deliberately: employeeRef, dates, restriction type
 *  and its numeric parameters. Those are the fields the firewall projects and
 *  the scheduler needs, and encrypting them would mean decrypting them on
 *  every solve for no privacy gain — they carry no clinical meaning.
 * ═════════════════════════════════════════════════════════════════════════ */
import crypto from 'node:crypto';

const PREFIX = 'v1';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

let cachedKey: Buffer | null = null;
let warned = false;

function key(): Buffer | null {
  if (cachedKey) return cachedKey;

  const raw = process.env.HEALTH_ENCRYPTION_KEY?.trim();
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'HEALTH_ENCRYPTION_KEY is not set. The health store holds clinical data and ' +
        'must not run unencrypted in production. Generate one with:\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    }
    if (!warned) {
      console.warn(
        '\n  [health] HEALTH_ENCRYPTION_KEY is not set — clinical fields are being stored\n' +
        '           in plain text. Fine for a local demo, never for real data.\n' +
        '           Set one in .env before any deployment.\n');
      warned = true;
    }
    return null;
  }

  const buf = Buffer.from(raw, 'hex');
  if (buf.length !== 32) {
    throw new Error(
      `HEALTH_ENCRYPTION_KEY must be 32 bytes as 64 hex characters (got ${buf.length} bytes). ` +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  cachedKey = buf;
  return cachedKey;
}

/** True when the value is already in our encrypted envelope. */
export const isEncrypted = (v: string | null | undefined): boolean =>
  typeof v === 'string' && v.startsWith(PREFIX + ':');

export function encrypt(plain: string | null | undefined): string | null {
  if (plain == null || plain === '') return plain ?? null;
  const k = key();
  if (!k) return plain;                        // dev without a key
  if (isEncrypted(plain)) return plain;        // already done

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, k, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [PREFIX, iv.toString('base64'), cipher.getAuthTag().toString('base64'),
          enc.toString('base64')].join(':');
}

export function decrypt(stored: string | null | undefined): string | null {
  if (stored == null || stored === '') return stored ?? null;
  if (!isEncrypted(stored)) return stored;     // written before encryption was on

  const k = key();
  if (!k) {
    throw new Error(
      'This record is encrypted but HEALTH_ENCRYPTION_KEY is not set. ' +
      'Set the key that was used to write it; without it the data cannot be read.');
  }

  const [, ivB64, tagB64, dataB64] = stored.split(':');
  try {
    const decipher = crypto.createDecipheriv(ALGO, k, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')), decipher.final(),
    ]).toString('utf8');
  } catch {
    /* GCM authentication failed: either the wrong key, or the ciphertext was
     * altered. Both are worth knowing about explicitly. */
    throw new Error(
      'A clinical record failed decryption. Either HEALTH_ENCRYPTION_KEY has changed ' +
      'since it was written, or the stored value was modified outside the application.');
  }
}

/** Applies encrypt/decrypt across a set of fields on an object. */
export const encryptFields = <T extends Record<string, any>>(row: T, fields: (keyof T)[]): T => {
  const out = { ...row };
  for (const f of fields) if (out[f] != null) (out as any)[f] = encrypt(String(out[f]));
  return out;
};

export const decryptFields = <T extends Record<string, any>>(row: T, fields: (keyof T)[]): T => {
  const out = { ...row };
  for (const f of fields) if (out[f] != null) (out as any)[f] = decrypt(String(out[f]));
  return out;
};

export const keyConfigured = () => {
  try { return key() !== null; } catch { return false; }
};
