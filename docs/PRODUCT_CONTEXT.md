# Product Context Plan

## Goal

Enrich the PR report with product priorities, roadmap items, and active tickets so the final report can say not just "what changed" but "how it maps to what the Weave product is trying to do."

## Preferred Boundary

Use Notion's first-party `ntn` CLI instead of direct Notion API client code when practical.

As of 2026-06-10:

- Package: `ntn`
- npm latest checked locally: `0.16.0`
- Local install check previously returned `command not found`
- Official docs:
  - `https://developers.notion.com/cli/get-started/overview`
  - `https://developers.notion.com/cli/guides/api-requests`
  - `https://developers.notion.com/cli/get-started/authentication`

## Setup Commands

Install:

```bash
curl -fsSL https://ntn.dev | bash
```

or:

```bash
npm install --global ntn
```

Authenticate:

```bash
ntn login
ntn doctor
```

For unattended environments, investigate `NOTION_API_TOKEN` and `NOTION_WORKSPACE_ID`.

## Proposed Config Shape

```json
{
  "productContextSources": {
    "notion": {
      "enabled": true,
      "pages": [
        {
          "id": "notion-page-id",
          "name": "Weave product priorities"
        }
      ],
      "dataSources": [
        {
          "id": "notion-data-source-id",
          "name": "Weave roadmap or tickets",
          "filter": {
            "property": "Status",
            "select": {
              "does_not_equal": "Done"
            }
          }
        }
      ]
    }
  }
}
```

## Proposed Data Model

```ts
type ProductContextItem = {
  source: "notion";
  kind: "priority" | "ticket" | "roadmap" | "doc";
  id: string;
  title: string;
  url?: string;
  status?: string;
  priority?: string;
  owners?: string[];
  area?: string;
  timeframe?: string;
  markdown?: string;
  keywords: string[];
};
```

Write normalized context to:

```text
runs/<interval-label>/product-context.json
```

## Suggested `ntn` Calls

Read a priority page:

```bash
ntn pages get <page-id>
```

Query a data source:

```bash
ntn datasources query <data-source-id> --limit 100 --filter '<json>'
```

Search workspace content:

```bash
ntn api v1/search --data '{"query":"weave roadmap","page_size":10}'
```

Inspect command/API details:

```bash
ntn api ls
ntn api <path> --help
ntn api <path> --docs
ntn api <path> --spec
```

## Agent Integration

Add a product context collector before GitHub collection:

```text
load config
  -> collect product context from ntn
  -> normalize and write product-context.json
  -> collect scoped PRs
  -> analyze PRs with product context available
  -> aggregate cards against priorities
```

Analyzer prompt additions:

- Identify whether the PR appears linked to an active priority or ticket.
- Cite the product-context item when there is evidence.
- Avoid forcing weak matches.

Card schema additions:

```ts
productContextMatches: Array<{
  id: string;
  title: string;
  confidence: "low" | "medium" | "high";
  rationale: string;
}>;
```

Orchestrator prompt additions:

- Group by product priorities when enough PRs map clearly.
- Include "unmapped but notable" work separately.
- Highlight priorities that received no PR activity if that is useful for leads.

## Implementation Notes

- Treat `ntn` as an external command adapter in `src/product-context/ntn.ts`.
- Keep raw CLI output or normalized snapshots in run artifacts for reproducibility.
- Fail gracefully if `ntn` is not installed or not authenticated.
- Do not make Notion access mandatory for GitHub-only reports.
- Record `ntn --version` in run metadata when product context is enabled.
