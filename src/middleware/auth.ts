/**
 * API Key Authentication Middleware
 *
 * Validates requests have a valid API key in the Authorization header.
 * Format: Authorization: Bearer <API_KEY>
 */

import { IncomingMessage, ServerResponse } from 'http';

const API_KEY = process.env.API_KEY;

interface AuthResult {
  authorized: boolean;
  error?: string;
}

export function validateApiKey(req: IncomingMessage): AuthResult {
  // If no API_KEY is configured, skip auth (development mode)
  if (!API_KEY) {
    console.warn('[Auth] No API_KEY configured - authentication disabled');
    return { authorized: true };
  }

  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return { authorized: false, error: 'Missing Authorization header' };
  }

  // Expected format: "Bearer <token>"
  const parts = authHeader.split(' ');

  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return { authorized: false, error: 'Invalid Authorization format. Expected: Bearer <token>' };
  }

  const token = parts[1];

  if (token !== API_KEY) {
    return { authorized: false, error: 'Invalid API key' };
  }

  return { authorized: true };
}

export function sendUnauthorized(res: ServerResponse, message: string): void {
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: false, error: message }));
}

/**
 * Paths that don't require authentication
 */
const PUBLIC_PATHS = ['/health', '/'];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname);
}
