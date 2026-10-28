import { app } from './app.js';
import { config } from './config.js';

// Bind to port specified in environment config and display public webhook URL
app.listen(config.PORT, () => {
  console.log(`[Awaaz Pay Server] listening on port ${config.PORT} (mode: ${config.NODE_ENV})`);
  if (config.PUBLIC_BASE_URL) {
    console.log(`[Awaaz Pay Server] public base URL: ${config.PUBLIC_BASE_URL}`);
  } else {
    console.log(
      '[Awaaz Pay Server] PUBLIC_BASE_URL is not configured (set this in production for PayPal webhook callbacks)'
    );
  }
});
