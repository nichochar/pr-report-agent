import { describe, expect, test } from "bun:test";
import {
  matchesCodeownersPattern,
  ownerScopedFiles,
  ownersForPath,
  parseCodeowners,
} from "../src/codeowners.js";

describe("CODEOWNERS matching", () => {
  test("uses last matching rule for owners", () => {
    const rules = parseCodeowners(`
* @wandb/weave-team
/weave/trace_server/migrations @tssweeney @gtarpenning @neutralino1
`);

    expect(ownersForPath("tests/trace/test_obj_delete.py", rules).owners).toEqual([
      "@wandb/weave-team",
    ]);
    expect(ownersForPath("weave/trace_server/migrations/001.sql", rules).owners).toEqual([
      "@tssweeney",
      "@gtarpenning",
      "@neutralino1",
    ]);
  });

  test("matches anchored directories and deep globs", () => {
    expect(matchesCodeownersPattern("frontends/weave/src/actions/foo.ts", "/frontends/weave/src/actions")).toBe(
      true,
    );
    expect(matchesCodeownersPattern("frontends/app/src/pages/FooWeaveTab.tsx", "/frontends/app/src/**/*WeaveTab**")).toBe(
      true,
    );
  });

  test("filters files to configured include owners", () => {
    const rules = parseCodeowners(`
/services/ @wandb/metrics-team @wandb/weave-team
/frontends/weave @wandb/weave-team
/frontends/weave/src/common @wandb/fe-infra-reviewers
`);

    expect(
      ownerScopedFiles(
        [
          "services/spiderweb/deploy/main.tf",
          "frontends/weave/src/common/Button.tsx",
          "frontends/weave/src/components/Page.tsx",
        ],
        rules,
        ["@wandb/weave-team"],
      ).map((match) => match.path),
    ).toEqual(["services/spiderweb/deploy/main.tf", "frontends/weave/src/components/Page.tsx"]);
  });
});
