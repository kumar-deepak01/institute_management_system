const { json } = require('../middleware/http');
const { handleRouteError } = require('../middleware/errorHandler');
const { api } = require('../controllers/apiController');
const { handleAdmissionsRoute } = require('../controllers/admissionsController');
const { handleCurriculumRoute } = require('../controllers/curriculumController');
const { handleAcademicsRoute } = require('../controllers/academicsController');
const { handleAcademicOperationsRoute, safeLog: logAcademicFailure } = require('../controllers/academicOperationsController');
const { handleContentMediaRoute } = require('../controllers/contentMediaController');
const { handlePayrollRoute } = require('../controllers/payrollController');
const { handleStaffInsightsRoute } = require('../controllers/staffInsightsController');
const { handleIntegrationsRoute } = require('../controllers/integrationsController');
const { handlePtmRoute } = require('../controllers/ptmController');
const { handleTeacherRoute } = require('../controllers/teacherController');
const { handleStudentPortalRoute } = require('../controllers/studentPortalController');
const { handlePhotosRoute } = require('./photos');
function logContentDispatchFailure(endpoint, error) {
  const code = String(error?.code || 'UNKNOWN').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40);
  const message = String(error?.message || 'Unknown error').replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[redacted]').replace(/\b(password|hash|cookie|authorization|database_url|secret|token|key)\b\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]').replace(/[\r\n\t]+/g, ' ').slice(0, 300);
  console.error(`[content-media] endpoint=${endpoint} step=route dispatch failed (code=${code}): ${message}`);
}
async function handleApiRoute(req, res, url) {
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(req.method)) return json(res, 405, { error: 'Method not allowed.' });
  if (url.pathname.startsWith('/api/photos/')) return handlePhotosRoute(req, res, url).catch(error => handleRouteError(error, res));
  const studentPortalResult = await handleStudentPortalRoute(req, res, url).catch(error => handleRouteError(error, res));
  if (studentPortalResult !== null) return studentPortalResult;
  const payrollResult = await handlePayrollRoute(req, res, url).catch(error => handleRouteError(error, res));
  if (payrollResult !== null) return payrollResult;
  const staffInsightsResult = await handleStaffInsightsRoute(req, res, url).catch(error => handleRouteError(error, res));
  if (staffInsightsResult !== null) return staffInsightsResult;
  const ptmResult = await handlePtmRoute(req, res, url).catch(error => handleRouteError(error, res));
  if (ptmResult !== null) return ptmResult;
  const teacherResult = await handleTeacherRoute(req, res, url).catch(error => handleRouteError(error, res));
  if (teacherResult !== null) return teacherResult;
  const integrationsResult = await handleIntegrationsRoute(req, res, url).catch(error => handleRouteError(error, res));
  if (integrationsResult !== null) return integrationsResult;
  const contentResult = await handleContentMediaRoute(req, res, url).catch(error => { logContentDispatchFailure(url.pathname, error); return json(res, 500, { error: 'Content request could not be completed.' }); });
  if (contentResult !== null) return contentResult;
  if (url.pathname.startsWith('/api/admin/curriculum/')) return handleCurriculumRoute(req, res, url).catch(error => handleRouteError(error, res));
  const academicResult = await handleAcademicOperationsRoute(req, res, url).catch(error => { logAcademicFailure(url.pathname, 'route dispatch', error); return json(res, 500, { error: 'Academic request could not be completed.' }); });
  if (academicResult !== null) return academicResult;
  if (url.pathname.startsWith('/api/admin/academics/')) return handleAcademicsRoute(req, res, url).catch(error => handleRouteError(error, res));
  if (url.pathname.startsWith('/api/admissions/') || url.pathname === '/api/admin/admissions' || url.pathname.startsWith('/api/admin/admissions/')) return handleAdmissionsRoute(req, res, url).catch(error => handleRouteError(error, res));
  return api(req, res, url).catch(error => handleRouteError(error, res));
}
module.exports = { handleApiRoute };
