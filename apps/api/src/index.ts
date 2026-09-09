import 'dotenv/config'; // loads apps/api/.env — must be the first import so getEnv() below sees it
import { createApp } from './app';
import { getEnv } from './lib/env';
import { registerScheduledJobs } from './jobs/scheduler';

const app = createApp();
const { PORT } = getEnv();

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on :${PORT}`);
});

registerScheduledJobs().catch((err) => {
  console.error('Failed to register scheduled jobs:', err);
});
