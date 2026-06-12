const express = require('express');
const searchRouter = require('./api/search');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use('/api', searchRouter);

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Settingly API running on port ${PORT}`);
});
