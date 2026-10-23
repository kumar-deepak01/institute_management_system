const { createClient } = require('@supabase/supabase-js');

let client;

function getSupabaseClient() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    const error = new Error('Supabase Storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env.');
    error.code = 'SUPABASE_NOT_CONFIGURED';
    throw error;
  }
  client = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  return client;
}

function getPhotoBucketName() {
  return process.env.SUPABASE_PHOTO_BUCKET || 'profile-photos';
}

module.exports = { getSupabaseClient, getPhotoBucketName };
