const { getSupabaseClient, getPhotoBucketName } = require('../lib/supabase');

const MAX_WEBP_BYTES = 50 * 1024;
const PHOTO_TYPES = new Set(['students', 'staff']);
let bucketVerification;

function photoPath(type, id) {
  if (!PHOTO_TYPES.has(type) || !/^[A-Za-z0-9_-]{1,120}$/.test(String(id))) throw new TypeError('Invalid profile photo type or id.');
  return `${type}/${id}.webp`;
}

async function uploadPhoto(type, id, buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_WEBP_BYTES) throw new RangeError('Processed profile photos must be at most 50 KB.');
  await verifyPhotoBucket();
  const path = photoPath(type, id);
  const { error } = await getSupabaseClient().storage.from(getPhotoBucketName()).upload(path, buffer, {
    contentType: 'image/webp', upsert: true, cacheControl: '600',
  });
  if (error) throw new Error('Profile photo could not be saved to private storage.');
  return path;
}

async function uploadAdmissionPhoto(applicationNo, buffer) {
  if (!/^APP-[0-9]{4}-[0-9]{5}$/.test(String(applicationNo))) throw new TypeError('Invalid admission application number.');
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_WEBP_BYTES) throw new RangeError('Processed admission photos must be at most 50 KB.');
  await verifyPhotoBucket();
  const path = `admissions/${applicationNo}.webp`;
  const { error } = await getSupabaseClient().storage.from(getPhotoBucketName()).upload(path, buffer, { contentType: 'image/webp', upsert: true, cacheControl: '600' });
  if (error) throw new Error('Admission photo could not be saved to private storage.');
  return path;
}

async function copyAdmissionPhotoToStudent(sourcePath, studentId) {
  if (!/^admissions\/APP-[0-9]{4}-[0-9]{5}\.webp$/.test(String(sourcePath))) throw new TypeError('Invalid admission photo path.');
  const destination = photoPath('students', studentId);
  await verifyPhotoBucket();
  const { error } = await getSupabaseClient().storage.from(getPhotoBucketName()).copy(sourcePath, destination);
  if (error) throw new Error('Admission photo could not be copied to the student profile.');
  return destination;
}

async function deleteStoredPhoto(path) {
  if (!/^(students|staff|admissions)\/[A-Za-z0-9_-]{1,120}\.webp$/.test(String(path))) throw new TypeError('Invalid photo path.');
  await verifyPhotoBucket();
  const { error } = await getSupabaseClient().storage.from(getPhotoBucketName()).remove([path]);
  if (error) throw new Error('Photo could not be removed from private storage.');
  return path;
}

async function getPhotoUrl(path, updatedAt) {
  if (!path) return null;
  await verifyPhotoBucket();
  const { data, error } = await getSupabaseClient().storage.from(getPhotoBucketName()).createSignedUrl(path, 600);
  if (error || !data?.signedUrl) throw new Error('Profile photo URL could not be created.');
  const url = new URL(data.signedUrl);
  if (updatedAt) url.searchParams.set('v', String(new Date(updatedAt).getTime() || updatedAt));
  return url.toString();
}

async function getPhotoUrls(items) {
  const eligible = items.map((item, index) => ({ ...item, index })).filter(item => item.path);
  const urls = new Array(items.length).fill(null);
  if (!eligible.length) return urls;
  await verifyPhotoBucket();
  const { data, error } = await getSupabaseClient().storage.from(getPhotoBucketName())
    .createSignedUrls(eligible.map(item => item.path), 600);
  if (error || !Array.isArray(data)) throw new Error('Profile photo URLs could not be created.');
  eligible.forEach((item, index) => {
    const signedUrl = data[index]?.signedUrl;
    if (!signedUrl) return;
    const url = new URL(signedUrl);
    if (item.updatedAt) url.searchParams.set('v', String(new Date(item.updatedAt).getTime() || item.updatedAt));
    urls[item.index] = url.toString();
  });
  return urls;
}

async function deletePhoto(type, id) {
  await verifyPhotoBucket();
  const path = photoPath(type, id);
  const { error } = await getSupabaseClient().storage.from(getPhotoBucketName()).remove([path]);
  if (error) throw new Error('Profile photo could not be removed from private storage.');
  return path;
}

async function verifyPhotoBucket() {
  if (bucketVerification) return bucketVerification;
  bucketVerification = (async () => {
    try {
      const { data, error } = await getSupabaseClient().storage.getBucket(getPhotoBucketName());
      if (error || !data) throw new Error('Supabase Storage photo bucket is unavailable. Check SUPABASE_PHOTO_BUCKET and bucket permissions.');
    } catch (error) {
      if (error?.code === 'SUPABASE_NOT_CONFIGURED') throw error;
      if (error?.message?.startsWith('Supabase Storage photo bucket')) throw error;
      throw new Error('Supabase Storage photo bucket could not be verified. Check SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_PHOTO_BUCKET.');
    }
  })();
  try {
    await bucketVerification;
  } catch (error) {
    bucketVerification = undefined;
    throw error;
  }
}

module.exports = { MAX_WEBP_BYTES, photoPath, uploadPhoto, uploadAdmissionPhoto, copyAdmissionPhotoToStudent, deleteStoredPhoto, getPhotoUrl, getPhotoUrls, deletePhoto, verifyPhotoBucket };
