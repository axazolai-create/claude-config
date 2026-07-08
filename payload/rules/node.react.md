---
paths:
  - "**/*.{jsx,tsx}"
  - "**/vite.config.*"
  - "**/*.stories.{jsx,tsx}"
---

# React (direction)
- Function components + hooks only. No class components.
- State: local `useState`/`useReducer`; server state via TanStack Query; reach for Redux
  only when genuinely global, cross-cutting state exists.
- Effects are a last resort — derive during render where possible. Every `useEffect`
  has a correct dependency array and cleanup.
- Keep components presentational; push data fetching to hooks/loaders.
- Styling: follow the repo (MUI is the house default — use its components/theme tokens,
  not ad-hoc inline styles).
- Accessibility: semantic elements, labelled controls, keyboard paths.
- Avoid: prop drilling >2 levels (context/composition), index as key in dynamic lists,
  business logic inside JSX.
