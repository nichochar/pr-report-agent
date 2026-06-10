import { describe, expect, test } from "bun:test";
import { isBotAuthor } from "../src/github.js";

describe("GitHub filtering", () => {
  test("excludes GitHub bot authors", () => {
    expect(
      isBotAuthor(
        {
          additions: 1,
          author: { login: "dependabot[bot]", is_bot: true },
          changedFiles: 1,
          deletions: 0,
          mergedAt: "2026-06-09T00:00:00Z",
          number: 1,
          title: "deps",
          url: "https://example.com",
        },
        [],
      ),
    ).toBe(true);
  });

  test("does not exclude human authors using AI labels", () => {
    expect(
      isBotAuthor(
        {
          additions: 1,
          author: { login: "gtarpenning", is_bot: false },
          changedFiles: 1,
          deletions: 0,
          labels: [{ name: "auto-griffin-claude" }],
          mergedAt: "2026-06-09T00:00:00Z",
          number: 1,
          title: "test",
          url: "https://example.com",
        },
        [],
      ),
    ).toBe(false);
  });
});
