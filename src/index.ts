/**
 * Personal Content Engine
 *
 * Entry point for the content engine that:
 * 1. Ingests content from trends, meetings, and voice notes
 * 2. Normalizes inputs into assets
 * 3. Generates weekly content batches (newsletter, blog, LinkedIn posts)
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { handleSourceMaterials, handleExtractions, handleExtractionsBatch, handleFireflies, handleVoiceNotes, handleTrends, handleManualNotes, handleGenerate, handleTrendSources, handleCrawl, handleDigestRoute, handleScheduler, handleTemplates, handleAdhoc, handleAssets, handleDocuments, handleStats, handleSettings, handleUsers, handleAllowedEmails, handlePodcasts } from './api';
import { startScheduler } from './services/scheduler';
import { validateAuth, sendUnauthorized, isPublicPath, setRequestUserId, setRequestUserRole } from './middleware/auth';
import { getDb } from './services/db';

const PORT = process.env.PORT || 3000;

function getPathname(req: IncomingMessage): string {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  return url.pathname;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const pathname = getPathname(req);

  // Health check (no auth required)
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // Authenticate API requests
  if (!isPublicPath(pathname)) {
    const auth = await validateAuth(req);
    if (!auth.authorized || !auth.userId) {
      sendUnauthorized(res, auth.error || 'Unauthorized');
      return;
    }
    setRequestUserId(req, auth.userId);

    // Fetch user role from settings
    try {
      const db = getDb();
      const { data: settings } = await db
        .from('user_settings')
        .select('role')
        .eq('user_id', auth.userId)
        .single();

      if (settings?.role) {
        setRequestUserRole(req, settings.role);
      }
    } catch {
      // Default to 'user' role if settings not found
    }
  }

  // API routes
  if (pathname === '/api/source-materials') {
    return handleSourceMaterials(req, res);
  }

  if (pathname === '/api/extractions') {
    return handleExtractions(req, res);
  }

  if (pathname === '/api/extractions/batch') {
    return handleExtractionsBatch(req, res);
  }

  if (pathname === '/api/ingest/fireflies') {
    return handleFireflies(req, res);
  }

  if (pathname === '/api/ingest/voice-note') {
    return handleVoiceNotes(req, res);
  }

  if (pathname === '/api/ingest/trend') {
    return handleTrends(req, res);
  }

  if (pathname === '/api/ingest/manual-note') {
    return handleManualNotes(req, res);
  }

  if (pathname === '/api/ingest/podcast') {
    return handlePodcasts(req, res);
  }

  if (pathname.startsWith('/api/generate/')) {
    return handleGenerate(req, res, pathname);
  }

  if (pathname.startsWith('/api/trend-sources')) {
    return handleTrendSources(req, res, pathname);
  }

  if (pathname.startsWith('/api/crawl/')) {
    return handleCrawl(req, res, pathname);
  }

  if (pathname === '/api/digest') {
    return handleDigestRoute(req, res);
  }

  if (pathname.startsWith('/api/scheduler/')) {
    return handleScheduler(req, res, pathname);
  }

  if (pathname.startsWith('/api/templates')) {
    return handleTemplates(req, res, pathname);
  }

  if (pathname === '/api/generate/adhoc' && req.method === 'POST') {
    return handleAdhoc(req, res);
  }

  if (pathname.startsWith('/api/assets')) {
    return handleAssets(req, res, pathname);
  }

  if (pathname.startsWith('/api/documents')) {
    return handleDocuments(req, res, pathname);
  }

  if (pathname === '/api/stats') {
    return handleStats(req, res);
  }

  if (pathname === '/api/settings') {
    return handleSettings(req, res);
  }

  if (pathname.startsWith('/api/users')) {
    return handleUsers(req, res, pathname);
  }

  if (pathname.startsWith('/api/allowed-emails')) {
    return handleAllowedEmails(req, res, pathname);
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

    // Start the background scheduler
    startScheduler();
  });
}

main().catch(console.error);
