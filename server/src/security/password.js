const crypto = require('node:crypto');
const { safeEqual } = require('../middleware/auth');

function passwordHash(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, 310000, 32, 'sha256', (error, key) => error ? reject(error) : resolve(key.toString('base64')));
  });
}

async function verifyPassword(password, salt, storedHash) {
  return safeEqual(await passwordHash(password, salt), storedHash);
}

module.exports = { passwordHash, verifyPassword };
