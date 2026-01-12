/**
 * Scheduler API
 *
 * GET /api/scheduler/status - Check scheduler status
 * POST /api/scheduler/trigger - Manually trigger a run
 */

import { IncomingMessage, ServerResponse } from 'http';
import { getSchedulerStatus, triggerManualRun, triggerAutoGeneration } from '../services/scheduler';
import { requireUserId } from '../middleware/auth';

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

function sendJson(res: ServerResponse, status: number, data: ApiResponse): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function handleStatus(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const status = getSchedulerStatus();
  sendJson(res, 200, { success: true, data: status });
}

async function handleTrigger(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    // Start the job but don't wait for it - return immediately
    const status = getSchedulerStatus();

    if (status.isRunning) {
      sendJson(res, 409, { success: false, error: 'Job already running' });
      return;
    }

    // Trigger async - don't await
    triggerManualRun()
      .then((result) => {
        console.log('[Scheduler API] Manual run completed:', result);
      })
      .catch((err) => {
        console.error('[Scheduler API] Manual run failed:', err);
      });

    sendJson(res, 202, {
      success: true,
      data: { message: 'Job started in background', status: 'running' },
    });
  } catch (err) {
    console.error('Error triggering scheduler:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

async function handleTriggerGeneration(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const userId = requireUserId(req);
    const status = getSchedulerStatus();

    if (status.isRunning) {
      sendJson(res, 409, { success: false, error: 'Scheduler job already running' });
      return;
    }

    console.log(`[Scheduler API] Manual auto-generation triggered by user ${userId}`);

    // Run synchronously so we can return results
    const result = await triggerAutoGeneration(userId);

    sendJson(res, 200, {
      success: true,
      data: {
        message: `Generated ${result.generated} assets`,
        generated: result.generated,
        errors: result.errors.length > 0 ? result.errors : undefined,
      },
    });
  } catch (err) {
    console.error('Error triggering auto-generation:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export async function handleScheduler(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<void> {
  if (pathname === '/api/scheduler/status' && req.method === 'GET') {
    return handleStatus(req, res);
  }

  if (pathname === '/api/scheduler/trigger' && req.method === 'POST') {
    return handleTrigger(req, res);
  }

  // Manual trigger for auto-generation (for testing)
  if (pathname === '/api/scheduler/generate' && req.method === 'POST') {
    return handleTriggerGeneration(req, res);
  }

  sendJson(res, 404, { success: false, error: 'Not found' });
}
