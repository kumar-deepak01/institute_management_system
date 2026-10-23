'use strict';

const crypto = require('node:crypto');

function encryptionKey() {
  const key = Buffer.from(process.env.INTEGRATIONS_ENCRYPTION_KEY || '', 'base64');
  if (key.length !== 32) throw Object.assign(new Error('Integration credential encryption is not configured.'), { code: 'INTEGRATIONS_KEY_INVALID' });
  return key;
}
function encryptIntegrationValue(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}
function decryptIntegrationValue(value) {
  const match = /^v1\.([^.]+)\.([^.]+)\.([^.]+)$/.exec(String(value || ''));
  if (!match) throw new Error('Stored integration credentials could not be decrypted.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(match[1], 'base64url'));
  decipher.setAuthTag(Buffer.from(match[2], 'base64url'));
  const clear = Buffer.concat([decipher.update(Buffer.from(match[3], 'base64url')), decipher.final()]).toString('utf8');
  return JSON.parse(clear);
}

module.exports = { encryptIntegrationValue, decryptIntegrationValue };
