# Old Home Page Backup

This folder contains files that were used only by the old home page (Page 1) layout (top nav with Features / Log in / Apply now, PageFrame, SiteHeader, and SiteFooter).

## Moved Files
- `client/src/components/PublicLayout.tsx` -> `_backup/old-home-page/client/src/components/PublicLayout.tsx`
- `client/src/components/PageFrame.tsx` -> `_backup/old-home-page/client/src/components/PageFrame.tsx`
- `client/src/components/SiteHeader.tsx` -> `_backup/old-home-page/client/src/components/SiteHeader.tsx`
- `client/src/components/SiteFooter.tsx` -> `_backup/old-home-page/client/src/components/SiteFooter.tsx`

## Shared Files Deliberately Left in Place
- `client/src/assets/mainlogo.png` (shared across portal and login branding)
- `client/src/components/AdminIcon.tsx` (shared navigation and utility icon system)
- `client/src/pages/AdmissionPage.tsx` (serves `/admissions` and `/form.html`)
- `client/src/pages/FeaturesPage.tsx` (serves `/features` and `/features.html`)
- `client/src/components/FeatureCard.tsx` (used by `FeaturesPage.tsx`)
- `client/src/components/SectionTitle.tsx` (used by `FeaturesPage.tsx`)
- `client/src/services/auth.ts`, `client/src/services/authCache.ts`, `client/src/services/api.ts` (core authentication logic)
- `client/src/types/api.ts` (API type definitions)

## How to Restore
To restore the old home page layout:
1. Move the files back to their original locations under `client/src/components/`:
   - Copy `_backup/old-home-page/client/src/components/PublicLayout.tsx` to `client/src/components/PublicLayout.tsx`
   - Copy `_backup/old-home-page/client/src/components/PageFrame.tsx` to `client/src/components/PageFrame.tsx`
   - Copy `_backup/old-home-page/client/src/components/SiteHeader.tsx` to `client/src/components/SiteHeader.tsx`
   - Copy `_backup/old-home-page/client/src/components/SiteFooter.tsx` to `client/src/components/SiteFooter.tsx`
2. In `client/src/App.tsx`, restore `PublicLayout` as the parent route for `path="/"`.
