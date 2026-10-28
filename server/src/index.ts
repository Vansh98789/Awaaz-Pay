import { app } from './app.js';
import { config } from './config.js';

// Bind to port specified in environment config
app.listen(config.PORT, () => {
  console.log(`[Awaaz Pay Server] listening on port ${config.PORT} (mode: ${config.NODE_ENV})`);
});
