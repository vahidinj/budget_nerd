# Frontend Style Guide

Maintains consistency in messaging, code style, and documentation across the React/TypeScript frontend.

## Messaging & Tone

- **Messaging**: Clear, direct, user-friendly. Avoid jargon unless explained.
- **Terminology**: Standardized terms across all messages:
  - "auto-tag" / "auto-tags" (not "heuristics" in user-facing messages)
  - "review and refine" (not "modify")
  - "AI refinement" (not "AI model" or "backend AI")
  - "error occurred" (not "encountered an error")
  - "persists" (not "continues")
  - "PDFs stay on your system" (privacy-focused language)

## Comment Style

- **File headers**: Short single-line comment describing the module purpose (e.g., `// Configuration: construct backend API URLs`)
- **Functions/components**: Minimal comments above the definition; complex logic gets inline comments
- **Avoid**: Block comment documentation (use JSDoc only for exported functions when necessary)
- **Format**: `// Comment text` (lowercase unless starting proper noun)

## Code Formatting

- **Spacing**: Consistent spacing around operators and keywords
- **Hyphens**: Use standard hyphen `-`, not unicode dashes (`–`, `—`, `‑`)
- **Template strings**: Use template literals for dynamic text, avoid concatenation where possible
- **Aria labels**: Provide meaningful, concise labels (not verbose, not terse)

## Component Structure

- **Props interface**: Named after component with `Props` suffix (e.g., `CategorizeClusterProps`)
- **State**: Avoid redundant boolean flags; use single source of truth where possible
- **Callbacks**: Use `useCallback` for event handlers passed to children

## Error Messages

- User-facing errors: Start with problem, suggest action
  - ✅ "An unexpected error occurred. Try Reset View."
  - ❌ "The app encountered an unexpected error. If the issue continues…"

## Theme & Colors

- Reference colors via CSS variables: `var(--accent)`, `var(--text-base)`
- Avoid hardcoded hex values in components; use theme tokens
- All chart colors centralized in `frontend/src/theme.ts`

## File Organization

```
frontend/src/
├── ui/
│   ├── App.tsx                 # Main app component
│   ├── [Component].tsx         # UI components
│   ├── hooks.ts                # Custom React hooks
│   ├── consistency.ts          # Data validation helpers
│   └── Charts/
│       └── index.ts            # Chart exports
├── config.ts                   # API configuration
├── theme.ts                    # Color & theme tokens
├── errorProbe.ts               # Error monitoring
├── main.tsx                    # React entrypoint
└── styles/
    └── theme.css               # CSS variables & styles
```

## Testing & QA

- Consistency checks on release: messaging tone, comment style, hyphenation, aria labels
- Visual regression: ensure component styling matches theme tokens
