# Accessibility audit

Linked Notes targets WCAG 2.2 AA for its critical local workspace flows. The
Phase 6 audit was completed on 19 July 2026 with Playwright 1.61.1, Axe 4.12.1,
Chromium, and the production Docker build. Automated checks complement, rather
than replace, observed keyboard, focus, contrast, and responsive review.

## Automated coverage

`tests/e2e/hardening-accessibility.spec.ts` runs Axe with the `wcag2a`,
`wcag2aa`, `wcag21a`, `wcag21aa`, and `wcag22aa` tags and verifies:

- explicit light and dark themes at 1440 × 1000;
- compact desktop, tablet, and mobile reflow at 1024 × 768, 768 × 1024, and
  390 × 844 with no document-level horizontal overflow;
- reduced-motion media preferences reducing transitions below one millisecond;
- organization and permanent-delete dialogs retaining focus through repeated
  Tab input, choosing a safe initial control, closing on Escape, and restoring
  focus to the invoking control;
- restrictive headers, stored-markup rendering, and unsafe-link rejection so
  security controls do not degrade the accessibility tree.

The broader browser suite also scans note creation/autosave, mobile pane
navigation, mention suggestions, backlinks, organization/search/lifecycle,
attachments, and backup/export states. Save, loading, conflict, upload, restore,
and error messages use `status` or `alert` live regions as appropriate.

The explicit Phase 6 suite passed 3/3 tests with zero Axe violations after fixing
one discovered defect: dark-theme white text on the amber primary button was
2.41:1. Theme-specific on-accent/on-danger tokens now preserve AA contrast.

## Observed manual audit

The rebuilt Docker UI was visually and semantically inspected at its natural
1332 × 1234 desktop viewport, 1024 × 768 compact desktop, 768 × 1024 tablet,
and 390 × 844 mobile viewport.

- The natural and 1024-pixel layouts retain the desktop-first three-pane
  workspace. Long note, folder, and tag labels truncate within their columns;
  the editor remains independently usable and no page-level horizontal scroll
  appears.
- At 768 and 390 pixels, the workspace becomes a deliberate single-pane flow
  with labelled menu and back controls. Controls remain comfortably separated,
  the search and filter rows reflow, and no content is clipped off-canvas.
- Light and dark themes preserve readable primary, secondary, muted, selected,
  danger, and focus states. Visible focus rings remain distinguishable from
  selection borders. The primary dark-theme contrast issue found by Axe was
  corrected and rechecked.
- The organization modal visibly dims and makes the workspace inert, places
  initial focus on its close control, keeps headings/tabs/forms labelled, and
  restores focus to **Manage folders**. The permanent-delete modal starts on
  **Keep note**, not the destructive action; keyboard automation verifies focus
  wrapping and restoration to **Delete note permanently**.
- Keyboard-only critical journeys are covered with real key events: Cmd/Ctrl+N
  creates, Cmd/Ctrl+K focuses search, Escape clears search or closes dialogs,
  mention suggestions accept arrows/Enter and dismiss with Escape, and dialogs
  do not permit global shortcuts to mutate the obscured workspace.
- Landmarks expose one main workspace, labelled navigation, named note lists,
  a labelled editor region, an editor toolbar, attachment region, live save
  state, and named dialogs. Decorative icons are hidden from assistive names;
  icon-only actions have explicit labels.

No physical screen-reader session was claimed. The audit reviewed the computed
accessibility tree, names, roles, states, focus order, and live-region behavior;
VoiceOver/NVDA user testing remains useful release feedback rather than hidden
evidence for this phase.

## Reproduce

```bash
npm run test:e2e
```

The HTML Playwright report is retained by CI for 14 days. Manual review should
be repeated after navigation, theme-token, dialog, editor-toolbar, or responsive
breakpoint changes.
