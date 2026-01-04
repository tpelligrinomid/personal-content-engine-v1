/**
 * Database service - Supabase client initialization
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabase: SupabaseClient | null = null;

export function getDb(): SupabaseClient {
  if (!supabase) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error(
        'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables'
      );
    }

    supabase = createClient(supabaseUrl, supabaseKey);
  }

  return supabase;
}

// TODO: Add typed query helpers as schema is defined
// TODO: Add connection health check
