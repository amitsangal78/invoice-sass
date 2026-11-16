import { createDatabase, assertRuntimeRole } from '@invoice/database';
import { createApp } from './app';
import { loadConfig } from './config';
const config=loadConfig(),db=createDatabase(config.DATABASE_URL);
await assertRuntimeRole(db);
const server=createApp(db,config).listen(config.PORT,'127.0.0.1',()=>console.log(JSON.stringify({event:'api_started',port:config.PORT,mode:'TEST'})));
async function stop(){server.close(async()=>{await db.end();process.exit(0);});}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
