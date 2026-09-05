import { createApp } from './app';
import { getEnv } from './lib/env';

const app = createApp();
const { PORT } = getEnv();

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on :${PORT}`);
});
