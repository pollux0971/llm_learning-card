@integration @i1 @i2 @i3 @i4 @i5 @i6
Feature: Every standalone entry point keeps working at every integration point
  ADR-022 requires each feature folder to stay runnable on its own, and ADR-024
  requires every integration point to be a complete working system. Put together
  that means the standalone manifest has to pass again at I1 through I6 — if
  integrating 03 quietly breaks 04's standalone command, that is a coupling bug
  and this is where it surfaces.

  The check is the same subprocess every time on purpose. `scripts/check-standalone.ts`
  runs the whole of `standalone.json` from the repo root, so there is nothing per
  integration point to vary — one scenario body, selected by every `@iN` tag, is
  the honest way to say that. `npx cucumber-js --tags "@i3"` still picks it up,
  exactly as it did when each integration file carried its own copy.

  Scenario: Every standalone entry point still runs
    When every non interactive command in the standalone manifest is executed
    Then each exits with status 0
    And each output contains the expected marker
