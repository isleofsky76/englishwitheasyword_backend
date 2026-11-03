/**
 * Cloudtype 진입점 — /healthz 를 즉시 연 뒤 본앱(index.js)을 로드합니다.
 * 기동 중 동기 라우트 등록이 길어도 liveness probe 가 headers 타임아웃 나지 않게 합니다.
 */
import dotenv from 'dotenv';
dotenv.config();

import { app } from './runtime.js';

app.set('trust proxy', true);

app.get('/healthz', (req, res) => {
  res.status(200).type('text/plain').send('OK');
});

const PORT = Number(process.env.PORT) || 3000;
const httpServer = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`- Health Check: http://localhost:${PORT}/healthz`);
});
httpServer.keepAliveTimeout = 65_000;
httpServer.headersTimeout = 66_000;

app.__eesListening = true;
globalThis.__EES_BOOTED_BY_SERVER = true;

/* listen 직후 한 틱 yield → kubelet probe 가 본앱 로드 중에도 응답 가능 */
await new Promise((resolve) => setImmediate(resolve));
await import('./index.js');
