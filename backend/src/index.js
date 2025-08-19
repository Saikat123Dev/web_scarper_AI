

import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import scrapeRouter from './routes/scrape.js';
import signup from './routes/signup.js';
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/scrape', scrapeRouter);
app.use('/', signup)
const PORT = process.env.PORT || 4001;
app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});

