# Services

`googleSheets.js` is used only by `scripts/migrate-google-sheets-data.js` to read the legacy spreadsheet during the one-time import. Runtime APIs use `postgresStore.js` and PostgreSQL as the authoritative persistence layer.
