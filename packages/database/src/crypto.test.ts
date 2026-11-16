import { expect,it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { hashPassword,checkPassword,seal,unseal } from './crypto';
it('salts password hashes and rejects wrong passwords',async()=>{
  const hash=await hashPassword('a-long-local-password');expect(hash).not.toContain('a-long-local-password');expect(await checkPassword('a-long-local-password',hash)).toBe(true);expect(await checkPassword('wrong-password',hash)).toBe(false);expect(await hashPassword('a-long-local-password')).not.toBe(hash);
});
it('authenticates encrypted delivery payloads and rejects tampering',()=>{
  const key=randomBytes(32).toString('hex'),payload={code:'123456',to:'test@example.com'};
  const encrypted=seal(payload,key);expect(encrypted.toString()).not.toContain('123456');expect(unseal(encrypted,key)).toEqual(payload);
  encrypted[encrypted.length-1]=encrypted[encrypted.length-1]!^1;expect(()=>unseal(encrypted,key)).toThrow();
});
