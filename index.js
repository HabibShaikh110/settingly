const express = require('express');
const searchRouter = require('./api/search');

const app = express();
const PORT = process.env.PORT || 3001;

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED:', err);
});

app.use(express.json());
app.use('/api', searchRouter);

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Settingly API running on port ${PORT}`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
