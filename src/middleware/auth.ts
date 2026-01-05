/**
 * Supabase JWT Authentication Middleware
 *
 * Validates requests have a valid Supabase access token in the Authorization header.
 * Format: Authorization: Bearer <access_token>
 */

import { IncomingMessage, ServerResponse } from 'http';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

// Create a Supabase client with service role for auth verification
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

export interface AuthResult {
  authorized: boolean;
  userId?: string;
  email?: string;
  error?: string;
}

/**
 * Check if an email is in the allowlist
 */
async function isEmailAllowed(email: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('allowed_emails')
    .select('id')
    .eq('email', email.toLowerCase())
    .single();

  return !error && !!data;
}

export async function validateAuth(req: IncomingMessage): Promise<AuthResult> {
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

  try {
    // Verify the JWT and get the user
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return { authorized: false, error: error?.message || 'Invalid or expired token' };
    }

    // Check if user's email is in the allowlist
    const email = user.email;
    if (!email) {
      return { authorized: false, error: 'User email not found' };
    }

    const allowed = await isEmailAllowed(email);
    if (!allowed) {
      return { authorized: false, error: 'Email not authorized. Contact an administrator for access.' };
    }

    return { authorized: true, userId: user.id, email };
  } catch (err) {
    console.error('[Auth] Token verification failed:', err);
    return { authorized: false, error: 'Token verification failed' };
  }
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

/**
 * Store user IDs by request for retrieval in handlers
 */
const requestUserMap = new WeakMap<IncomingMessage, string>();

export function setRequestUserId(req: IncomingMessage, userId: string): void {
  requestUserMap.set(req, userId);
}

export function getRequestUserId(req: IncomingMessage): string | undefined {
  return requestUserMap.get(req);
}

export function requireUserId(req: IncomingMessage): string {
  const userId = requestUserMap.get(req);
  if (!userId) {
    throw new Error('User ID not found - authentication middleware may have failed');
  }
  return userId;
}

/**
 * Store user roles by request for admin checks
 */
const requestRoleMap = new WeakMap<IncomingMessage, string>();

export function setRequestUserRole(req: IncomingMessage, role: string): void {
  requestRoleMap.set(req, role);
}

export function getRequestUserRole(req: IncomingMessage): string {
  return requestRoleMap.get(req) || 'user';
}

export function isAdmin(req: IncomingMessage): boolean {
  return requestRoleMap.get(req) === 'admin';
}

export function requireAdmin(req: IncomingMessage): void {
  if (!isAdmin(req)) {
    throw new Error('Admin access required');
  }
}
