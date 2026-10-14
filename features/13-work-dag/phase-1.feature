@wave0 @work-dag @phase-1
# The @standalone tag is deliberately NOT on this file yet. check:dry-run fails when the
# standalone set has undefined steps, and this phase has no step definitions until it is
# implemented. Whoever implements phase-1 adds @standalone to the tag line in the same
# change that adds the step definitions (and the standalone.json entry).
Feature: The work graph is derived from the files that already exist
  The coordinator needs to know what can start now, what is stuck and on whom.
  The tool reads phase statuses (FEATURE.md), gates (NEXT.md) and integration tags,
  and prints a report. It never writes anything and it runs without any other module.

  # Notes for whoever writes the step definitions:
  # - NEXT.md gate text is quoted verbatim in Traditional Chinese because the tool must read
  #   the real file format (an ASCII colon after the word for "needs", the ideographic comma
  #   between items). Everything else in this file is English.
  # - A "gate" in a docstring is the text of one NEXT.md; the step writes it to the fake tree.
  # - "the tag" steps run git init in the temporary tree and create real tags. There is no
  #   test-only flag for tags.
  # - "the report has the line" means a whole line, compared exactly.
  # - Output shape: features/13-work-dag/FEATURE.md, section "Output shape".

  Scenario: The tool runs on its own against the bundled fixture tree
    When the dag tool runs on the bundled fixture tree "basic"
    Then it exits with status 0
    And the report has the line "READY 01-alpha/phase-2"
    And the report has the line "BLOCKED 01-alpha/phase-3 by 01-alpha/phase-2"
    And the report has the line "BLOCKED 02-beta/phase-2 by 01-alpha/phase-3"
    And the summary line says "ready=1 blocked=2 human=0 problems=0"

  Scenario Outline: A phase is ready only when the phase before it is done
    Given the fake tree has these features:
      | folder   | phase | status     |
      | 01-alpha | 1     | <status>   |
      | 01-alpha | 2     | todo       |
    And the next file of "01-alpha" says:
      """
      **phase-1**:無 gate。

      **phase-2** 需要:
      - [ ] 自身:phase-1 `done`
      """
    When the dag tool runs on the fake tree
    Then the report has the line "<line>"

    Examples:
      | status      | line                                         |
      | done        | READY 01-alpha/phase-2 (table says todo)     |
      | in-progress | BLOCKED 01-alpha/phase-2 by 01-alpha/phase-1 |
      | todo        | BLOCKED 01-alpha/phase-2 by 01-alpha/phase-1 |
      | ready       | BLOCKED 01-alpha/phase-2 by 01-alpha/phase-1 |
      | blocked     | BLOCKED 01-alpha/phase-2 by 01-alpha/phase-1 |

  Scenario Outline: A phase that is already running or finished is never offered as ready
    Given the fake tree has these features:
      | folder   | phase | status   |
      | 01-alpha | 1     | done     |
      | 01-alpha | 2     | <status> |
    And the next file of "01-alpha" says "**phase-2** 需要:phase-1 `done`"
    When the dag tool runs on the fake tree
    Then the report has no READY line for "01-alpha/phase-2"
    And the report has no BLOCKED line for "01-alpha/phase-2"
    And the summary line says "ready=0 blocked=0 human=0 problems=0"

    Examples:
      | status      |
      | in-progress |
      | done        |

  Scenario: A phase marked blocked in its own table stays blocked even when its gate is met
    Given the fake tree has these features:
      | folder   | phase | status  |
      | 01-alpha | 1     | done    |
      | 01-alpha | 2     | blocked |
    And the next file of "01-alpha" says "**phase-2** 需要:phase-1 `done`"
    When the dag tool runs on the fake tree
    Then the report has the line "BLOCKED 01-alpha/phase-2 by status:blocked"
    And the report has no READY line for "01-alpha/phase-2"

  Scenario: A phase whose table row says ready is reported without a status note
    Given the fake tree has these features:
      | folder   | phase | status |
      | 01-alpha | 1     | done   |
      | 01-alpha | 2     | ready  |
    And the next file of "01-alpha" says "**phase-2** 需要:phase-1 `done`"
    When the dag tool runs on the fake tree
    Then the report has the line "READY 01-alpha/phase-2"
    And the summary line says "ready=1 blocked=0 human=0 problems=0"

  Scenario Outline: The three ways of writing a phase reference name the same node
    Given the fake tree has these features:
      | folder   | phase | status |
      | 01-alpha | 1     | todo   |
      | 02-beta  | 1     | todo   |
      | 02-beta  | 2     | todo   |
    And the next file of "01-alpha" says "**phase-1**:無 gate。"
    And the next file of "02-beta" says "**phase-2** 需要:<gate>"
    When the dag tool runs on the fake tree
    Then the report has the line "<line>"

    Examples:
      | gate                          | line                                          |
      | 01-alpha/phase-1 `done`       | BLOCKED 02-beta/phase-2 by 01-alpha/phase-1   |
      | 01 phase-1 `done`             | BLOCKED 02-beta/phase-2 by 01-alpha/phase-1   |
      | phase-1 `done`                | BLOCKED 02-beta/phase-2 by 02-beta/phase-1    |

  Scenario: A ticked checkbox does not count as done
    Given the fake tree has these features:
      | folder   | phase | status      |
      | 01-alpha | 1     | in-progress |
      | 01-alpha | 2     | todo        |
    And the next file of "01-alpha" says:
      """
      **phase-2** 需要:
      - [x] 自身:phase-1 `done`
      - [ ] 整合:無
      """
    When the dag tool runs on the fake tree
    Then the report has the line "BLOCKED 01-alpha/phase-2 by 01-alpha/phase-1"
    And the report has no READY line for "01-alpha/phase-2"

  Scenario: Several unfinished things are listed together in a fixed order
    Given the fake tree has these features:
      | folder   | phase | status |
      | 01-alpha | 1     | todo   |
      | 02-beta  | 1     | done   |
      | 02-beta  | 2     | todo   |
    And the next file of "02-beta" says "**phase-2** 需要:phase-1 `done`、01 phase-1 `done`、**I4 通過**"
    When the dag tool runs on the fake tree
    Then the report has the line "BLOCKED 02-beta/phase-2 by 01-alpha/phase-1,I4"

  Scenario: An integration point without its tag blocks, and a look-alike tag does not unblock it
    Given the fake tree has these features:
      | folder   | phase | status |
      | 01-alpha | 1     | done   |
      | 01-alpha | 2     | todo   |
    And the next file of "01-alpha" says "**phase-2** 需要:phase-1 `done`、**I4 通過**"
    And the tree has the tag "i4-integration-wiring"
    When the dag tool runs on the fake tree
    Then the report has the line "BLOCKED 01-alpha/phase-2 by I4"
    And the report has no READY line for "01-alpha/phase-2"

  Scenario: An integration point with its exact tag lets the phase start
    Given the fake tree has these features:
      | folder   | phase | status |
      | 01-alpha | 1     | done   |
      | 01-alpha | 2     | todo   |
    And the next file of "01-alpha" says "**phase-2** 需要:phase-1 `done`、**I4 通過**"
    And the tree has the tag "I4"
    When the dag tool runs on the fake tree
    Then the report has the line "READY 01-alpha/phase-2 (table says todo)"
    And the report has no BLOCKED line for "01-alpha/phase-2"

  Scenario Outline: A decision gate is handed to a human and never guessed
    Given the fake tree has these features:
      | folder   | phase | status |
      | 01-alpha | 1     | done   |
      | 01-alpha | 2     | todo   |
    And the next file of "01-alpha" says "**phase-2** 需要:phase-1 `done`、<reference> 已決定"
    When the dag tool runs on the fake tree
    Then the report has the line "HUMAN 01-alpha/phase-2 decision <shown>"
    And the report has no READY line for "01-alpha/phase-2"
    And the summary line says "ready=0 blocked=0 human=1 problems=0"

    Examples:
      | reference    | shown        |
      | ADR-040      | ADR-040      |
      | §13          | §13          |
      | §11b         | §11b         |
      | 9a8b7c6      | commit 9a8b7c6 |

  Scenario: A decision that already exists in the decision map is still left to a human
    Given the fake tree has these features:
      | folder   | phase | status |
      | 01-alpha | 1     | done   |
      | 01-alpha | 2     | todo   |
    And the next file of "01-alpha" says "**phase-2** 需要:phase-1 `done`、ADR-040 已決定"
    And the fake tree has a decision map with the heading "## ADR-040 · an accepted decision"
    When the dag tool runs on the fake tree
    Then the report has the line "HUMAN 01-alpha/phase-2 decision ADR-040"
    And the report has no READY line for "01-alpha/phase-2"

  Scenario: A phase that says it has no gate is ready
    Given the fake tree has these features:
      | folder   | phase | status |
      | 01-alpha | 1     | todo   |
    And the next file of "01-alpha" says "**phase-1**:無 gate。placeholder only, touches no core。"
    When the dag tool runs on the fake tree
    Then the report has the line "READY 01-alpha/phase-1"
    And the summary line says "ready=1 blocked=0 human=0 problems=0"

  Scenario: A phase with no gate statement at all is not guessed ready
    Given the fake tree has these features:
      | folder   | phase | status |
      | 01-alpha | 1     | done   |
      | 01-alpha | 2     | todo   |
    And the next file of "01-alpha" says "# 01 · alpha — next steps"
    When the dag tool runs on the fake tree
    Then the report has the line "PROBLEM gate-not-declared 01-alpha/phase-2"
    And the report has no READY line for "01-alpha/phase-2"

  Scenario: A reference to a phase that does not exist is reported and the tool keeps going
    Given the fake tree has these features:
      | folder   | phase | status |
      | 01-alpha | 1     | done   |
      | 01-alpha | 2     | todo   |
      | 02-beta  | 1     | todo   |
    And the next file of "01-alpha" says "**phase-2** 需要:09 phase-7 `done`"
    And the next file of "02-beta" says "**phase-1**:無 gate。"
    When the dag tool runs on the fake tree
    Then it exits with status 0
    And the report has the line "PROBLEM unresolved-ref 01-alpha/phase-2 09 phase-7"
    And the report has the line "READY 02-beta/phase-1"
    And the summary line says "ready=1 blocked=0 human=0 problems=1"

  Scenario: A cycle is reported once and none of its members is offered as ready
    Given the fake tree has these features:
      | folder   | phase | status |
      | 01-alpha | 1     | done   |
      | 01-alpha | 2     | todo   |
      | 02-beta  | 1     | done   |
      | 02-beta  | 2     | todo   |
    And the next file of "01-alpha" says "**phase-2** 需要:02 phase-2 `done`"
    And the next file of "02-beta" says "**phase-2** 需要:01 phase-2 `done`"
    When the dag tool runs on the fake tree
    Then it exits with status 0
    And the report has the line "PROBLEM cycle 01-alpha/phase-2 -> 02-beta/phase-2 -> 01-alpha/phase-2"
    And the report has no READY line for "01-alpha/phase-2"
    And the report has no READY line for "02-beta/phase-2"

  Scenario: A feature folder without a phase table is reported and the others are still read
    Given the fake tree has these features:
      | folder   | phase | status |
      | 01-alpha | 1     | todo   |
    And the next file of "01-alpha" says "**phase-1**:無 gate。"
    And the fake tree has a feature folder "03-gamma" whose FEATURE file has no phase table
    When the dag tool runs on the fake tree
    Then the report has the line "PROBLEM no-phase-table 03-gamma"
    And the report has the line "READY 01-alpha/phase-1"

  Scenario: The graph is printed as a mermaid block with one edge per dependency
    Given the fake tree has these features:
      | folder   | phase | status |
      | 01-alpha | 1     | done   |
      | 01-alpha | 2     | todo   |
      | 01-alpha | 3     | todo   |
    And the next file of "01-alpha" says:
      """
      **phase-2** 需要:phase-1 `done`

      **phase-3** 需要:phase-2 `done`、**I4 通過**
      """
    When the dag tool runs on the fake tree
    Then the report contains a mermaid block that starts with "graph TD"
    And the mermaid block has an edge from "01-alpha/phase-1" to "01-alpha/phase-2"
    And the mermaid block has an edge from "I4" to "01-alpha/phase-3"
    And the mermaid block has exactly 3 edges

  Scenario: Decision gates are listed for a human and are not drawn as edges
    Given the fake tree has these features:
      | folder   | phase | status |
      | 01-alpha | 1     | done   |
      | 01-alpha | 2     | todo   |
    And the next file of "01-alpha" says "**phase-2** 需要:phase-1 `done`、ADR-040 已決定"
    When the dag tool runs on the fake tree
    Then the report has the line "HUMAN 01-alpha/phase-2 decision ADR-040"
    And the mermaid block has exactly 1 edge
    And the mermaid block has no node "ADR-040"

  Scenario: Running the tool changes nothing in the tree
    Given the bundled fixture tree "basic" is copied to a temporary directory
    And the bytes of every file in the temporary tree are recorded
    When the dag tool runs on the temporary tree
    Then the report is not empty
    And the bytes of every file in the temporary tree are the same as recorded
    And no file was added to or removed from the temporary tree

  Scenario: The same tree gives the same report every time
    Given the bundled fixture tree "basic" is copied to a temporary directory
    When the dag tool runs on the temporary tree twice
    Then the two reports are identical byte for byte
    And the report is not empty

  Scenario Outline: Bad invocations are usage errors, not reports
    When the dag tool runs with the arguments "<arguments>"
    Then it exits with status 2
    And the error output contains "<message>"
    And the standard output has no summary line

    Examples:
      | arguments                          | message              |
      |                                    | Usage:               |
      | --root /nonexistent-dag-root       | root not found       |
      | --root <an empty temporary folder> | no features directory |
