// Single source of truth for database tables that must NEVER be wiped or dropped during test-data cleanups.
const PROTECTED_TABLES = Object.freeze([
  'accounts',
  'schema_migrations',
  'institute_settings',
  'courses',
  'batches',
  'subjects',
  'topics',
  'academic_years',
  'fee_types',
  'fee_structures',
  'staff_integrations',
]);

function isTableProtected(tableName) {
  const normalized = String(tableName || '').trim().toLowerCase().replace(/^public\./, '');
  return PROTECTED_TABLES.includes(normalized);
}

function assertTableNotProtected(tableName, operation = 'delete') {
  if (isTableProtected(tableName)) {
    const error = new Error(`SAFETY VIOLATION: Cannot ${operation} protected table "${tableName}". This table is required for auth and core institute operations.`);
    error.code = 'PROTECTED_TABLE_VIOLATION';
    throw error;
  }
}

module.exports = {
  PROTECTED_TABLES,
  isTableProtected,
  assertTableNotProtected,
};

