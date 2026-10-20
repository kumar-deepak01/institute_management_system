'use strict';

const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const SHEET_NAMES = ['Students', 'Admissions', 'Staff', 'Courses', 'Batches', 'Attendance', 'Fees'];
const RECORD_HEADERS = ['id', 'record_json'];
let sheetsPromise;
let spreadsheetReady;

function configuration() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = String(process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!spreadsheetId || !clientEmail || !privateKey) {
    const error = new Error('Google Sheets is not configured. Set GOOGLE_SHEETS_SPREADSHEET_ID, GOOGLE_CLIENT_EMAIL, and GOOGLE_PRIVATE_KEY.');
    error.code = 'SHEETS_NOT_CONFIGURED';
    throw error;
  }
  return { spreadsheetId, clientEmail, privateKey };
}

async function getSheets() {
  if (!sheetsPromise) {
    const { clientEmail, privateKey } = configuration();
    const auth = new google.auth.GoogleAuth({
      credentials: { client_email: clientEmail, private_key: privateKey },
      scopes: SCOPES,
    });
    sheetsPromise = auth.getClient().then(authClient => google.sheets({ version: 'v4', auth: authClient }));
  }
  return sheetsPromise;
}

function spreadsheetId() { return configuration().spreadsheetId; }

function rowsFromValues(values) {
  if (!Array.isArray(values) || !values.length) return [];
  if (values.every(value => !Array.isArray(value))) return [values];
  return values.map(row => Array.isArray(row) ? row : [row]);
}

async function getSheetData(range) {
  if (!range || typeof range !== 'string') throw new TypeError('A Google Sheets range is required.');
  try {
    const sheets = await getSheets();
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: spreadsheetId(), range });
    return response.data.values || [];
  } catch (error) { throw sheetError(error, 'read'); }
}

async function appendSheetData(range, values) {
  if (!range || typeof range !== 'string') throw new TypeError('A Google Sheets range is required.');
  const rows = rowsFromValues(values);
  if (!rows.length) return null;
  try {
    const sheets = await getSheets();
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheetId(), range, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
      requestBody: { majorDimension: 'ROWS', values: rows },
    });
    return response.data;
  } catch (error) { throw sheetError(error, 'append'); }
}

async function updateSheetData(range, values) {
  if (!range || typeof range !== 'string') throw new TypeError('A Google Sheets range is required.');
  const rows = rowsFromValues(values);
  try {
    const sheets = await getSheets();
    const response = await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId(), range, valueInputOption: 'RAW',
      requestBody: { majorDimension: 'ROWS', values: rows },
    });
    return response.data;
  } catch (error) { throw sheetError(error, 'update'); }
}

function sheetError(error, operation) {
  if (error && error.code === 'SHEETS_NOT_CONFIGURED') return error;
  const status = Number(error?.response?.status || error?.code || 0);
  const message = status === 403 ? 'Google Sheets denied access. Share the spreadsheet with the configured service account and enable the Sheets API.'
    : status === 404 ? 'The configured Google spreadsheet or requested sheet tab was not found.'
      : 'Google Sheets could not complete the request.';
  const wrapped = new Error(message);
  wrapped.code = 'SHEETS_REQUEST_FAILED';
  wrapped.operation = operation;
  wrapped.status = status || undefined;
  wrapped.cause = error;
  return wrapped;
}

async function ensureSheets() {
  if (!spreadsheetReady) {
    spreadsheetReady = (async () => {
      const sheets = await getSheets();
      const id = spreadsheetId();
      const response = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties(sheetId,title)' });
      const present = new Map((response.data.sheets || []).map(item => [item.properties.title, item.properties.sheetId]));
      const missing = SHEET_NAMES.filter(name => !present.has(name));
      if (missing.length) {
        await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: missing.map(title => ({ addSheet: { properties: { title } } })) } });
      }
      for (const title of SHEET_NAMES) {
        const values = await getSheetData(`${quoteTab(title)}!A1:B1`);
        if (!values.length) await updateSheetData(`${quoteTab(title)}!A1:B1`, [RECORD_HEADERS]);
        else if (values[0][0] !== RECORD_HEADERS[0] || values[0][1] !== RECORD_HEADERS[1]) {
          throw new Error(`The ${title} tab must use the first-row headers: id, record_json.`);
        }
      }
    })().catch(error => { spreadsheetReady = null; throw error; });
  }
  return spreadsheetReady;
}

function quoteTab(tab) { return `'${String(tab).replace(/'/g, "''")}'`; }

function parseRecords(values) {
  return rowsFromValues(values).slice(1).flatMap(row => {
    if (!row[0] || !row[1]) return [];
    try {
      const record = JSON.parse(row[1]);
      return record && typeof record === 'object' && !Array.isArray(record) ? [{ ...record, id: String(row[0]) }] : [];
    } catch { return []; }
  });
}

async function getSheetRecords(tab) {
  if (!SHEET_NAMES.includes(tab)) throw new TypeError(`Unsupported Google Sheets tab: ${tab}`);
  await ensureSheets();
  return parseRecords(await getSheetData(`${quoteTab(tab)}!A:B`));
}

async function appendSheetRecord(tab, record) {
  if (!SHEET_NAMES.includes(tab) || !record || typeof record !== 'object' || !record.id) throw new TypeError('A supported tab and record with an id are required.');
  await ensureSheets();
  await appendSheetData(`${quoteTab(tab)}!A:B`, [[String(record.id), JSON.stringify(record)]]);
  return record;
}

async function saveSheetRecords(tab, records) {
  if (!SHEET_NAMES.includes(tab) || !Array.isArray(records)) throw new TypeError('A supported tab and records array are required.');
  if (records.some(record => !record || typeof record !== 'object' || !record.id)) throw new TypeError('Every sheet record must have an id.');
  await ensureSheets();
  const sheets = await getSheets();
  const id = spreadsheetId();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties(sheetId,title)' });
  const sheet = (meta.data.sheets || []).find(item => item.properties.title === tab);
  if (!sheet) throw new Error(`The ${tab} tab could not be found.`);
  const lastRow = Number((await getSheetData(`${quoteTab(tab)}!A:A`)).length || 1);
  const requests = [];
  if (lastRow > 1) requests.push({ deleteDimension: { range: { sheetId: sheet.properties.sheetId, dimension: 'ROWS', startIndex: 1, endIndex: lastRow } } });
  if (records.length) requests.push({ updateCells: {
    start: { sheetId: sheet.properties.sheetId, rowIndex: 1, columnIndex: 0 },
    rows: records.map(record => ({ values: [
      { userEnteredValue: { stringValue: String(record.id) } },
      { userEnteredValue: { stringValue: JSON.stringify(record) } },
    ] })),
    fields: 'userEnteredValue',
  } });
  if (requests.length) {
    try { await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests } }); }
    catch (error) { throw sheetError(error, 'save'); }
  }
  return records;
}

async function replaceRecordGroup(tab, predicate, replacements) {
  const current = await getSheetRecords(tab);
  return saveSheetRecords(tab, [...current.filter(record => !predicate(record)), ...replacements]);
}

module.exports = { SHEET_NAMES, getSheetData, appendSheetData, updateSheetData, getSheetRecords, appendSheetRecord, saveSheetRecords, replaceRecordGroup };
