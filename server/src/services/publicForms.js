const crypto = require('node:crypto');
const { getPool } = require('./postgresStore');

async function saveTrialRequest({ name, email, instituteName, phone }) {
  const id = crypto.randomUUID();
  await getPool().query(
    'insert into public.trial_requests(id,name,email,institute_name,phone) values($1,$2,$3,$4,$5)',
    [id, name, email, instituteName, phone || null],
  );
  return id;
}
async function saveNewsletterEmail(email) {
  await getPool().query('insert into public.newsletter_subscribers(id,email) values($1,$2) on conflict(email) do nothing', [crypto.randomUUID(), email]);
}
module.exports = { saveTrialRequest, saveNewsletterEmail };
