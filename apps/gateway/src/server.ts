import { buildGatewayServer } from './index.js';

async function startGateway(): Promise<void> {
  const app = await buildGatewayServer();
  const port = Number(process.env.GATEWAY_PORT ?? 3002);
  await app.listen({ port, host: '0.0.0.0' });
}

startGateway().catch((err) => {
  console.error(err);
  process.exit(1);
});
