# Frontend Rules Architecture & Best Practices

## 1. Test-Driven Development (TDD) Required
Absolutely every new React component, business logic hook, or major UI refactoring must be accompanied by its corresponding test. 
- Tests must be placed in the `/test` directory.
- `Vitest` and `@testing-library/react` are the standards.
- Run tests via `npm run test`. Component tests ensure UI regression does not occur upon iterations.

## 2. Docs-as-Code
The `.redbus-docs/` folder represents the living state of our app's logic. Any architectural decision regarding frontend layout or shared components should be documented here.
If a UI pattern or structure fundamentally changes, this document must be updated.

## 3. UI Aesthetics & Homogenization
- **Titles and Headers:** Sidebar sections and main layout views must use a lowercase title scheme styled with Lucide vectors on the left.
  ```tsx
  import { Mail } from 'lucide-react';
  
  <h2><Mail size={16} style={{ display: 'inline', verticalAlign: 'sub', marginRight: '6px' }} /> comunicações</h2>
  ```
- **Styling:** We use standard vanilla CSS (`src/index.css`) rather than Tailwind CSS. Custom `.mtg-*` UI classes are used for most structural components.
- **Component Reusability:** Shared UI elements, just like the `MiniCalendar.tsx`, must be contained within `src/components/Layout` or `src/components/Shared`. Never repeatedly put complex interactive logic inside view-level components (`Page.tsx` or `View.tsx`).

## 4. Zero Secrets in Components
Do not store environment variables, API keys, or strict user configurations blindly inside React states. Let the main process (`Electron`) manage and parse it directly via the `window.redbusAPI`.
