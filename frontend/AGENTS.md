<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## AgentWhatsApp frontend rules

- Work only within the `frontend` workspace unless backend access is explicitly requested.
- Keep App Router pages and layouts thin; compose substantial UI from shared or feature-owned components.
- Default to Server Components. Add `"use client"` only for browser APIs, hooks, or interactive behavior.
- Keep static product configuration in `src/config` and do not duplicate navigation, constants, types, or API logic.
- Place feature-specific domain logic under `src/features/<feature>` as features are implemented.
- Centralize future API integration in dedicated service or feature data-access modules rather than UI components.
