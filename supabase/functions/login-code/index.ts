// Happy Life – sign in on a new device with a login code.
// The app on the new device sends { code }. If the code is valid (made in the
// last 10 minutes, not used before), this returns a one-time token hash that
// the app exchanges for a session with supabase.auth.verifyOtp(). No email
// is sent. Codes are made in the app by create_login_code().
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { code } = await req.json().catch(() => ({}));
    if (typeof code !== 'string' || code.length > 40) return json({ error: 'invalid' }, 400);

    const { data: userId, error } = await admin.rpc('redeem_login_code', { p_code: code });
    if (error) {
      if (/too many/.test(error.message)) return json({ error: 'too_many' }, 429);
      throw error;
    }
    if (!userId) {
      // Easy mix-up: the family invitation code looks the same – say so
      const norm = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const { data: fam } = await admin.from('families').select('id').eq('invite_code', norm).maybeSingle();
      return json({ error: fam ? 'invite_code' : 'invalid' }, 400);
    }

    const { data: u, error: e1 } = await admin.auth.admin.getUserById(userId);
    if (e1 || !u?.user?.email) throw e1 || new Error('user has no email');
    // Makes a one-time sign-in token without sending an email
    const { data: link, error: e2 } = await admin.auth.admin.generateLink({ type: 'magiclink', email: u.user.email });
    if (e2) throw e2;
    return json({ token_hash: link.properties.hashed_token });
  } catch (e) {
    console.error(e);
    return json({ error: 'server' }, 500);
  }
});
