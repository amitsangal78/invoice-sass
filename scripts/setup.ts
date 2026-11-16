import { access,readFile,writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
try{await access('.env');console.log('.env already exists; left unchanged.');}
catch{
  const template=await readFile('.env.example','utf8');
  const content=template.replace('replace-with-at-least-32-random-characters',randomBytes(32).toString('hex')).replace('replace-with-64-hexadecimal-characters',randomBytes(32).toString('hex'));
  await writeFile('.env',content,{mode:0o600,flag:'wx'});
  console.log('Created private local .env. Start PostgreSQL, then run npm run db:migrate.');
}
