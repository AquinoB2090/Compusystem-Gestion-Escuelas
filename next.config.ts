import type { NextConfig } from 'next';

// Supabase's Vercel Quickstart provides these unprefixed public values.
// Promote only the project URL and publishable/anon key to Next.js's public env.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || process.env.SUPABASE_PUBLISHABLE_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const publicSupabaseEnv: Record<string, string> = {};
if (supabaseUrl) publicSupabaseEnv.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
if (supabasePublishableKey) publicSupabaseEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = supabasePublishableKey;

const nextConfig: NextConfig = { env: publicSupabaseEnv };
export default nextConfig;
