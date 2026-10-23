# UI design specification

## Visual system

- Use DM Sans for interface text and Manrope for headings, loaded from Google Fonts with sensible system fallbacks.
- Primary blue is approximately `#2862ec`; use dark navy text, white surfaces, and a light blue-gray portal canvas.
- Marketing pages use spacious white sections and blue hero surfaces. Portal pages use a fixed white sidebar, white top bar, rounded white panels, subtle borders, and restrained shadows.
- Use consistent rounded controls and cards; keep buttons visibly interactive and provide focus-visible states.

## Navigation and entry points

- `index.html`: public marketing homepage and default project entry.
- `features.html`: public feature catalogue.
- `login.html`: common development login, then role selector.
- `admin.html`, `teacher.html`, `student.html`: role-specific workspaces, rendered from shared `portal.js` and `portal.css`.
- `portal.html`: retained compatibility entry that opens the common login.
- Public Log in buttons point to `login.html`. Start Free Trial opens the local request dialog.
- Portal logout points to `login.html`.

## Responsive behavior

- Public navigation collapses behind the menu toggle at narrow widths.
- Portal sidebar becomes an off-canvas menu on small screens; cards and tables adapt through CSS breakpoints.
- Visual responsive behavior remains to be confirmed in an interactive browser pass.

## Interaction language

- Login is explicitly marked as a local prototype; empty credentials are accepted and are neither transmitted nor persisted.
- Feature-dependent actions use dialogs, sample downloads, local-storage demo records, or visible placeholder copy.
- Do not imply that the prototype provides secure authentication or operational backend services.
