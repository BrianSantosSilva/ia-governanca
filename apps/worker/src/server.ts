import { checkDatabaseConnection, closePool, getPool } from '@ia-governanca/database';
import { MetricsRegistry } from '@ia-governanca/observability';
import crypto from 'node:crypto';
import { createServer } from 'node:http';
import { workerMetrics } from './sync-executor.js';

const port = Number(process.env.WORKER_PORT ?? 3003);
const server = createServer(async (request, response) => {
  if (request.method !== 'GET' || (request.url !== '/health' && request.url !== '/metrics')) {
    response.writeHead(404).end();
    return;
  }

  if (request.url === '/metrics') {
    workerMetrics.increment('worker_metrics_scrapes_total');
    try {
      const persistedMetrics = new MetricsRegistry();
      const syncRuns = await getPool().query<{
        provider: string;
        dataset: string;
        status: string;
        run_count: number;
        records_created: number;
        duration_ms_sum: number;
        duration_count: number;
      }>(
        `SELECT COALESCE(pc.provider, 'unknown') AS provider, sr.dataset, sr.status,
                COUNT(*)::int AS run_count,
                COALESCE(SUM(sr.records_created), 0)::int AS records_created,
                COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(sr.finished_at, NOW()) - sr.started_at)) * 1000), 0)::float
                  AS duration_ms_sum,
                COUNT(*)::int AS duration_count
         FROM sync_runs sr
         LEFT JOIN provider_connections pc
           ON pc.id = sr.provider_connection_id AND pc.organization_id = sr.organization_id
         GROUP BY COALESCE(pc.provider, 'unknown'), sr.dataset, sr.status`,
      );
      for (const run of syncRuns.rows) {
        const labels = { provider: run.provider, dataset: run.dataset, status: run.status };
        persistedMetrics.increment('worker_sync_runs_persisted_total', labels, run.run_count);
        persistedMetrics.increment(
          'worker_records_ingested_persisted_total',
          { provider: run.provider, dataset: run.dataset },
          run.records_created,
        );
        persistedMetrics.increment('worker_sync_duration_ms_sum_total', labels, run.duration_ms_sum);
        persistedMetrics.increment('worker_sync_duration_count_total', labels, run.duration_count);
      }
      response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
      response.end(workerMetrics.render() + persistedMetrics.render());
    } catch {
      process.stderr.write(
        `${JSON.stringify({
          request_id: crypto.randomUUID(),
          organization_id: null,
          project_id: null,
          provider: null,
          status: 'failed',
          duration_ms: null,
          error_code: 'worker_metrics_unavailable',
        })}\n`,
      );
      response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('worker_metrics_unavailable\n');
    }
    return;
  }

  try {
    const database = await checkDatabaseConnection(getPool());
    const status = database ? 200 : 503;
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ status: database ? 'ok' : 'degraded', service: 'worker', database }));
  } catch {
    response.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ status: 'degraded', service: 'worker', database: false }));
  }
});

server.listen(port, '0.0.0.0');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void closePool()
        .then(() => process.exit(0))
        .catch(() => {
          process.stderr.write(`${JSON.stringify({ status: 'failed', error_code: 'worker_shutdown_failed' })}\n`);
          process.exit(1);
        });
    });
  });
}
