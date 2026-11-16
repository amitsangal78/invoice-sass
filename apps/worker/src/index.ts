import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createDatabase,assertRuntimeRole } from '@invoice/database';
import { deliverOne } from './deliver';
if(!['local','ses-local','ses','resend'].includes(process.env.DELIVERY_MODE??'local'))throw new Error('Unsupported DELIVERY_MODE.');
if(!process.env.DATABASE_URL || !/^[a-f0-9]{64}$/i.test(process.env.DELIVERY_KEY??''))throw new Error('DATABASE_URL and a 32-byte DELIVERY_KEY are required.');
const db=createDatabase(process.env.DATABASE_URL);
await assertRuntimeRole(db);
const root=fileURLToPath(new URL('../../../',import.meta.url));
const directory=resolve(root,process.env.LOCAL_MAIL_DIR??'.local/mail');
console.log(JSON.stringify({event:'worker_started',delivery:process.env.DELIVERY_MODE??'local',directory}));
let stopping=false;
process.once('SIGINT',()=>{stopping=true;});process.once('SIGTERM',()=>{stopping=true;});
try{while(!stopping){try{if(!await deliverOne(db,process.env.DELIVERY_KEY!,directory))await delay(1000);}catch{console.error(JSON.stringify({event:'worker_poll_failed'}));await delay(3000);}}}
finally{await db.end();}
