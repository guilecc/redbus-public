# Spec: Hybrid Deterministic DOM Scrapers for RedBus

**Status:** Draft / Planned
**Target:** RedBus `intelligentExtractor.ts` & `channelManager.ts`
**Objective:** Reduce LLM token consumption by ~90% and increase extraction speed by 10x during the Daily Digest process. Transition from a pure LLM-navigated extraction (MCP-like) to a hybrid approach prioritizing deterministic Playwright scrapers for Microsoft Outlook and Teams.

---

## 1. Context & Motivation

Currently, RedBus uses an agentic LLM approach (`intelligentExtractor.ts`) to navigate web applications. The LLM receives Accessibility Tree snapshots, decides where to click, scrolls, and eventually extracts data.

### The Problem
- **High Token Cost:** Each snapshot sent to the LLM can easily hit 10k-20k tokens. A 5-step navigation loop consumes up to 100k input tokens just to fetch a few emails.
- **Latency:** Inference takes time. An extraction process can take multiple minutes.
- **Flakiness:** Modern JS-heavy apps change states rapidly. The LLM might hallucinate interactions or fail to locate the target if the UI re-renders during a snapshot.

### The Solution (Path 2)
Implement **Static DOM Scrapers** using Playwright's native capabilities (`page.locator()`, XPath, CSS selectors).
Use the LLM *only* for the final summarization step (`digestService.ts`), completely removing it from the data-gathering phase for known, structured apps like Outlook and Teams.

---

## 2. Architecture Overview: The Hybrid Strategy

We will not completely delete the `intelligentExtractor.ts`. Instead, we will implement a proxy layer that routes known channels to highly optimized deterministic scrapers. If a user adds an unknown/custom channel URL, the system falls back to the agentic LLM extractor.

```mermaid
graph TD
    A[ChannelManager] --> B{Is Known Channel?}
    B -- Yes (outlook, teams) --> C[StaticExtractor (Playwright)]
    B -- No (custom URL) --> D[IntelligentExtractor (LLM)]
    C --> E[UnifiedMessage[]]
    D --> E
    E --> F[DigestService (LLM Summarization)]
```

---

## 3. Implementation Details

### 3.1 New Module: `staticExtractor.ts`
This module will hold the deterministic scraping logic.

**Core Interface:**
```typescript
interface ScraperDefinition {
    channelId: 'outlook' | 'teams';
    validateAuth: (page: Page) => Promise<boolean>;
    waitReady: (page: Page) => Promise<void>;
    extract: (page: Page, targetDate?: string) => Promise<UnifiedMessage[]>;
}
```

### 3.2 Outlook Web Scraper Specification

Outlook Web loads messages dynamically in a virtualized list.

**Flow:**
1. **Wait State:** `page.waitForSelector('[data-custom-id="MailList"]', { timeout: 10000 })`.
2. **Date Targeting:** The DOM groups emails by headers (e.g., "Today", "Yesterday"). We must locate the corresponding header based on `targetDate`.
3. **Extraction Strategy:**
   - Iterate through message containers.
   - Extract `sender` from elements with typical aria-labels like `aria-label="From..."` or specific classes.
   - Extract `subject` from spans with classes related to subject lines.
   - Extract `preview` from the body snippet div.
   - Check `isUnread` by inspecting the font-weight or specific unread badges/icons inside the container.
4. **Scrolling:** Since the list is virtualized, to get history, rely on `page.mouse.wheel()` inside the message list container and await new DOM nodes entering the view until the target date boundary is crossed.

### 3.3 Microsoft Teams Scraper Specification

Teams (specifically version 2/v2) uses a complex shadow DOM and iframe-based architecture at times.

**Flow:**
1. **Navigation:** Ensure we are on the "Chat" tab. `page.locator('button[data-tid="chat-app-button"]').click()`.
2. **Wait State:** `page.waitForSelector('.virtual-list-container', { timeout: 10000 })`.
3. **Extraction Strategy:**
   - Find recent conversations in the sidebar.
   - We must iterate over `.chat-list-item` nodes.
   - Extact `sender` from the profile name span.
   - Extract `preview` from the latest message text preview node.
   - The timestamp is usually available in the `aria-label` of the timestamp element.
4. **Resiliency:** Teams is notorious for changing classes. Use generic `aria-labels` and `data-tid` attributes whenever possible, as they are stabler than CSS classes.

---

## 4. Addressing Fragility (The "Smart Selector" pattern)

Deterministic scrapers break when Microsoft changes the UI. We must implement a self-healing or failsafe mechanism.

**Approach: CSS/XPath Definitions as Configuration**
Instead of hardcoding selectors like `.foo-bar-123` in TypeScript files, we will define them in a configuration file or SQLite database table (`ExtractorConfigs`).

*Example configuration:*
```json
{
  "outlook": {
    "listContainer": "[aria-label='Message list']",
    "messageNode": "[role='option']",
    "sender": "span[aria-label^='From']",
    "subject": ".subjectLine",
    "preview": ".previewText"
  }
}
```

**Failsafe:** If a selector fails (returns 0 elements for 3 consecutive days), the `staticExtractor` throws a specific `'SELECTOR_STALE'` error. The `channelManager` catches this and temporarily routes that channel to the `intelligentExtractor.ts` (LLM fallback) while generating an alert for the developer/user to update the static selector.

---

## 5. Execution Plan (TDD Approach)

1. **Phase 1: Foundation**
   - Create `staticExtractor.ts` and the configuration interface.
   - Set up Vitest tests using Playwright's testing utilities with mocked HTML responses mimicking Outlook and Teams DOMs.
2. **Phase 2: The Outlook Scraper**
   - Implement the Outlook extraction logic.
   - Focus heavily on handling virtualized list scrolling (a common trap in web automation).
   - Test extraction accuracy and parsing logic.
3. **Phase 3: The Teams Scraper**
   - Implement the Teams extraction logic.
   - Account for varying DOM structures (Group chats vs. 1-to-1 chats).
4. **Phase 4: Integration Engine**
   - Update `extractAll` inside `channelManager.ts` to use the proxy router.
   - Implement the LLM fallback logic upon encountering `'SELECTOR_STALE'`.
5. **Phase 5: Performance Profiling**
   - Run a benchmark script comparing `intelligentExtractor` vs `staticExtractor`. We expect execution time to drop from ~180 seconds to < 5 seconds per channel.

---

## 6. Constraints & Rules

1. **Security:** Auth tokens/cookies must continue to leverage RedBus's local browser context. Do not trigger new logins.
2. **No External APIs:** We must not use Graph API. The mandate is to keep RedBus operating as a local User Agent intercepting the existing DOM state visually/structurally.
3. **Silent Failures:** If extraction fails, log locally but do not crash the Worker Loop. Return empty arrays so `digestService` gracefully acknowledges the lack of new data.
