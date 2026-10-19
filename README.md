<<<<<<< HEAD
# Coach Sutra — concept website

A responsive, static front-end inspired by the Coach Sutra reference screenshots and public Features page. It contains the marketing homepage, categorized feature catalogue, and a role-based institute workspace preview.

## Run locally

Serve this folder with Python:

```powershell
python -m http.server 5173
```

Then visit `http://localhost:5173/`. The public homepage is the entry point. The shared login and role picker are at `/login.html`; role workspaces have separate entries at `/admin.html`, `/teacher.html`, and `/student.html`. `/portal.html` remains as a compatibility alias for the login page. `features.html` opens the public features catalogue.

Alternatively, with Node.js installed, run `npx serve .` and open the local URL it prints.

## Current scope

This is a front-end concept. The portal login accepts blank fields and proceeds to a role picker for local exploration. Admin, Teacher and Student workspaces use demo data; selected records are kept in browser local storage. Forms, attendance, chat, downloads, and settings are local preview interactions only. There is no production authentication, database, payment processing, actual AI service, file upload service, or messaging integration. See `docs/implementation-audit.md` for checked requirements and verification limits.

The REA public-site observations used for the feature structure were captured in temporary clean Chromium sessions: homepage Evidence `ev_d80c87c1295417d19374155f94f42791ef85ed770fa90fe14a3f6b46cccdb47e`, Features Evidence `ev_59a5757407707fdbd339365082c869189598dfb3ce42aea342525bc1ce0ea7e6`.
=======
# institute_management_system
>>>>>>> c95f47de0f10925aec3e5c8b3d5730e7050f8ce2
