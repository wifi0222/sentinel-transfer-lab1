import https from 'node:https';

const port = Number(process.env.PORT ?? 8443);
const request = https.get({ host: '127.0.0.1', port, path: '/api/health', rejectUnauthorized: false, timeout: 3000 }, (response) => {
  response.resume();
  process.exit(response.statusCode === 200 ? 0 : 1);
});
request.on('error', () => process.exit(1));
request.on('timeout', () => request.destroy(new Error('timeout')));

