require('dotenv').config();
const { getPool } = require('../src/services/postgresStore');
const { downloadListSql, videoListSql, liveListSql, lookupsSql } = require('../src/controllers/contentMediaController');

const checks = [
  ['download-list', downloadListSql, ['', '', '', '', 24, 0]],
  ['video-list', videoListSql, ['', '', '', '', 24, 0]],
  ['live-class-list', liveListSql, ['', '', '', 24, 0]],
  ['content-lookups', lookupsSql, []],
  ['download-stats', `select count(*)::int total,count(*) filter(where (status='published' or (status='scheduled' and publish_at<=now())) and (expires_at is null or expires_at>now()))::int published,count(*) filter(where status='scheduled' and (publish_at is null or publish_at>now()))::int scheduled,count(*) filter(where expires_at<=now())::int expired from public.download_items`, []],
  ['video-stats', `select count(*)::int total,count(*) filter(where status='published')::int published,(select count(*)::int from public.video_watch_progress)::int total_views,coalesce((select round(avg(case when completed then 100 else 0 end))::int from public.video_watch_progress),0)::int avg_completion from public.video_lectures`, []],
  ['live-class-stats', `select count(*) filter(where status='scheduled' and scheduled_at<=now() and scheduled_at+duration_minutes*interval '1 minute'>now())::int live_now,count(*) filter(where status='scheduled' and scheduled_at>now())::int upcoming,count(*) filter(where status='completed' or scheduled_at+duration_minutes*interval '1 minute'<=now())::int completed from public.live_classes`, []],
  ['attachment-link', `select storage_path,original_name from public.download_attachments where id=$1 and download_id=$2`, ['__sample_attachment__', '__sample_download__']],
];

function safeMessage(error) {
  return String(error?.message || 'Unknown error')
    .replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[redacted]')
    .replace(/\b(password|hash|cookie|authorization|database_url|secret|token|key)\b\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/[\r\n\t]+/g, ' ').slice(0, 240);
}

async function main() {
  const client = await getPool().connect();
  try {
    await client.query('begin read only');
    for (let index = 0; index < checks.length; index += 1) {
      const [name, sql, values] = checks[index];
      const savepoint = `content_check_${index}`;
      await client.query(`savepoint ${savepoint}`);
      try {
        await client.query(sql, values);
        console.log(`${name}: OK`);
      } catch (error) {
        await client.query(`rollback to savepoint ${savepoint}`);
        console.log(`${name}: ${String(error?.code || 'UNKNOWN').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40)} ${safeMessage(error)}`);
      } finally {
        await client.query(`release savepoint ${savepoint}`);
      }
    }
    await client.query('rollback');
  } finally {
    client.release();
  }
}

main().catch(error => {
  console.log(`${String(error?.code || 'UNKNOWN').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40)} ${safeMessage(error)}`);
  process.exitCode = 1;
});
