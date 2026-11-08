-- Happy Life – run the `remind` Edge Function every 5 minutes.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run
-- (after deploying the function). Safe to run again.
-- If the first two lines fail, turn on "pg_cron" and "pg_net" under
-- Database -> Extensions and run the rest.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('happylife-reminders')
  where exists (select 1 from cron.job where jobname = 'happylife-reminders');

-- The anon key is public (it's also in config.js); the function only ever
-- sends reminders that are due, once, so calling it is harmless.
select cron.schedule('happylife-reminders', '*/5 * * * *', $$
  select net.http_post(
    url     := 'https://ddafsqnpbplblfjovqpf.supabase.co/functions/v1/remind',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkYWZzcW5wYnBsYmxmam92cXBmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQxMjkxMDQsImV4cCI6MjEwOTcwNTEwNH0.4dhUq_7QvpmqEUFuOoRIR5UvvwQxepiYlDPhY3jFZq8'),
    body    := '{}'::jsonb)
$$);
