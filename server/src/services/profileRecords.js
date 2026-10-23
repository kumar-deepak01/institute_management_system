const sheetsStore = require('./postgresStore');
const collections = require('../models/collections');
const { getPool } = require('./postgresStore');

const supported = new Set(['students', 'staff']);

function collectionInfo(type) {
  if (!supported.has(type)) throw new TypeError('Profile photos are only supported for students and staff.');
  return collections[type];
}

async function findProfile(type, id) {
  const [tab, recordType] = collectionInfo(type);
  const records = await sheetsStore.getSheetRecords(tab);
  const record = records.find(item => item._type === 'app-data' && item.collection === recordType && (
    item.id === id || item.student_id === id || item.studentId === id || item.employee_id === id || item.employeeId === id
  ));
  if (!record) return null;
  const { rows } = await getPool().query(`select id,photo_path,photo_updated_at from public.${type} where id=$1`, [record.id]);
  const metadata = rows[0];
  if (!metadata) throw new Error('Profile photo metadata is unavailable. Apply the PostgreSQL business-data migration.');
  return { ...record, photo_path: metadata.photo_path || null, photo_updated_at: metadata.photo_updated_at || null };
}

async function getPhotoMetadata(type, recordId) {
  collectionInfo(type);
  const { rows } = await getPool().query(`select photo_path,photo_updated_at from public.${type} where id=$1`, [recordId]);
  const metadata = rows[0];
  if (!metadata) return { photo_path: null, photo_updated_at: null };
  return { photo_path: metadata.photo_path || null, photo_updated_at: metadata.photo_updated_at || null };
}

async function saveProfile(type, profile, metadata = {}) {
  collectionInfo(type);
  const { rows } = await getPool().query(
    `insert into public.${type}(id,photo_path,photo_updated_at) values($1,$2,$3)
     on conflict(id) do update set photo_path=excluded.photo_path,photo_updated_at=excluded.photo_updated_at
     returning id,photo_path,photo_updated_at`,
    [String(profile.id), metadata.photo_path ?? null, metadata.photo_updated_at ?? null],
  );
  return { ...profile, photo_path: rows[0].photo_path, photo_updated_at: rows[0].photo_updated_at };
}

module.exports = { findProfile, getPhotoMetadata, saveProfile };
