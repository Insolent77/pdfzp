import 'dotenv/config';
import { createApp } from './app';
const app = createApp();
app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0', () =>
  console.log(`Мой Ломоносов: порт ${process.env.PORT ?? 3000}`),
);
