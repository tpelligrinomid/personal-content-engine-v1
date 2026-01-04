/**
 * Personal Content Engine
 *
 * Entry point for the content engine that:
 * 1. Ingests content from trends, meetings, and voice notes
 * 2. Normalizes inputs into assets
 * 3. Generates weekly content batches (newsletter, blog, LinkedIn posts)
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { handleSourceMaterials, handleExtractions, handleFireflies } from './api';

// TODO: Set up scheduled jobs for weekly batch generation

const PORT = process.env.PORT || 3000;

function getPathname(req: IncomingMessage): string {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  return url.pathname;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const pathname = getPathname(req);

  // Health check
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // API routes
  if (pathname === '/api/source-materials') {
    return handleSourceMaterials(req, res);
  }

  if (pathname === '/api/extractions') {
    return handleExtractions(req, res);
  }

  if (pathname === '/api/ingest/fireflies') {
    return handleFireflies(req, res);
  }

  // Default response
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ service: 'personal-content-engine', status: 'running' }));
}

async function main() {
  console.log('Personal Content Engine starting...');

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error('Unhandled error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
    });
  });

  server.listen(PORT, () => {
    console.log(`Engine running on port ${PORT}`);
  });
}

main().catch(console.error);
