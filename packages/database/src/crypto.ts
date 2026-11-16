import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt as rawScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(rawScrypt);
export const tokenHash = (token: string) => createHash('sha256').update(token).digest();
export const secretHmac = (secret: string, value: string) => createHmac('sha256', secret).update(value).digest();

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64) as Buffer;
  return `scrypt:${salt}:${hash.toString('hex')}`;
}
export async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [kind,salt,hex] = stored.split(':');
  if(kind!=='scrypt' || !salt || !hex || !/^[a-f0-9]{128}$/.test(hex)) return false;
  const actual = await scrypt(password,salt,64) as Buffer;
  return timingSafeEqual(actual,Buffer.from(hex,'hex'));
}
export function seal(value: unknown, keyHex: string): Buffer {
  const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',Buffer.from(keyHex,'hex'),iv);
  const body=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),body]);
}
export function unseal(value: Buffer, keyHex: string): unknown {
  const cipher=createDecipheriv('aes-256-gcm',Buffer.from(keyHex,'hex'),value.subarray(0,12));
  cipher.setAuthTag(value.subarray(12,28));
  return JSON.parse(Buffer.concat([cipher.update(value.subarray(28)),cipher.final()]).toString('utf8'));
}
