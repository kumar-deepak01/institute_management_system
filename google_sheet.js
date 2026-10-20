const { google } = require('googleapis');

// Vercel environment variables se credentials load karna
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '1mdnc_J_3EkmxLnS4c9sI6mFrRerZ0OlfDNNbktAb4k8';

async function getSheetData(range) {
  const client = await auth.getClient();
  const googleSheets = google.sheets({ version: 'v4', auth: client });
  const response = await googleSheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: range,
  });
  return response.data.values || [];
}

async function appendSheetData(range, valuesArray) {
  const client = await auth.getClient();
  const googleSheets = google.sheets({ version: 'v4', auth: client });
  const response = await googleSheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: range,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [valuesArray] },
  });
  return response.data;
}

module.exports = { getSheetData, appendSheetData };