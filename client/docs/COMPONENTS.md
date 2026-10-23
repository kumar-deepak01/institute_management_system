# Pages and shared components

## Pages

| Page | Route(s) | Purpose |
| --- | --- | --- |
| `HomePage` | `/`, `/index.html` | Marketing home, plan selector, trial dialog, newsletter, and cookie preference. |
| `FeaturesPage` | `/features`, `/features.html` | Feature catalogue. |
| `AdmissionPage` | `/admissions`, `/form.html` | Public admission form, batch/config loading, validation, and submission. |
| `LoginPage` | `/login`, `/login.html`, `/portal`, `/portal.html` | Login, OTP, forgot/reset password flows. |
| `AdminPage` | `/admin/*`, `/admin.html` | Admin workspace: overview, student/admission records, attendance, staff, courses, fees, and settings. |
| `TeacherPage` | `/teacher`, `/teacher.html` | Teacher dashboard, classes, attendance, homework, students, and messages. |
| `StudentPage` | `/student`, `/student.html` | Student dashboard, courses, assignments, attendance, fees, and resources. |

## Shared components

| Component | Purpose |
| --- | --- |
| `SiteHeader`, `SiteFooter` | Shared public-site navigation and footer. |
| `PageFrame`, `SectionTitle`, `FeatureCard` | Public page layout and feature sections. |
| `TrialDialog`, `CookieNotice` | Trial signup dialog and persisted cookie notice. |
| `MetricCard`, `WorkspaceLayout` | Dashboard metrics and shared authenticated workspace shell. |
| `Avatar` | Single profile-photo display component; falls back to initials when absent or when image loading fails. |
| `PhotoUpload` | Compresses selected JPEG/PNG/WebP to 400×400 WebP <=50 KB, previews it, and displays validation errors. |

`useStoredState` provides typed local-storage-backed UI state. API access is implemented in `src/services/`; see [ENV.md](ENV.md) for configuration.
