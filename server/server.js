require('dotenv').config();
const { handleRequest, start } = require('./src/app');
if (require.main === module) start().catch(error => { console.error('Could not start My JEE Mentor: ' + error.message); process.exitCode = 1; });
module.exports = { handleRequest, start };