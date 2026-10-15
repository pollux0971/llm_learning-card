@work-dag @phase-2
Feature: Tickets join the graph and the parallel rules turn it into a start list
  The same tool also reads the ticket headers, applies the five parallel rules, says which tickets
  can start together and which are held back and why, prints the commands that would create the
  tasks (it never runs them), and turns graph mistakes into a red check.

  # Notes for whoever writes the step definitions:
  # - A ticket table row builds a ticket file in docs/tickets/ with a valid header. Columns that
  #   are not in the table get these defaults: budget_usd 1, owner worker-grok, must_catch [].
  #   A "deps" or "touches" cell is a comma-separated list, empty for none.
  # - "the dag tool runs" is the report only. "the dag check runs" adds --check, which is the
  #   command behind npm run dag:check. Without --check the exit status is 0 even with problems.
  # - Output shape: features/13-work-dag/FEATURE.md, section "Output shape".
  # - The landing table is scripts/boundaries.owners.json of the fake tree: [prefix, landing] pairs.

  Background:
    Given the fake tree has this landing table:
      | prefix                            | landing        |
      | contracts/                        | contracts      |
      | packages/                         | core           |
      | packages/core/src/scheduler/      | 04-scheduler   |
      | apps/desktop/                     | 10-desktop-shell |
      | scripts/                          | infra          |
      | docs/                             | docs           |

  Scenario: A ticket whose dependencies are merged is ready
    Given the fake tree has these tickets:
      | id | deps | touches       | cpu   | status |
      | T1 |      | docs/a/       | light | merged |
      | T2 | T1   | docs/b/       | light | todo   |
    When the dag tool runs on the fake tree
    Then the report has the line "READY T2"
    And the report has no READY line for "T1"
    And the summary line says "ready=1 blocked=0 human=0 problems=0"

  Scenario Outline: A ticket that is not waiting to be started is never offered as ready
    Given the fake tree has these tickets:
      | id | deps | touches | cpu   | status   |
      | T1 |      | docs/a/ | light | <status> |
    When the dag tool runs on the fake tree
    Then the report has no READY line for "T1"
    And the report has no START line for "T1"

    Examples:
      | status     |
      | dispatched |
      | review     |
      | merged     |
      | dropped    |

  Scenario: A ticket waits for a dependency that is not merged yet
    Given the fake tree has these tickets:
      | id | deps | touches | cpu   | status     |
      | T1 |      | docs/a/ | light | dispatched |
      | T2 | T1   | docs/b/ | light | todo       |
    When the dag tool runs on the fake tree
    Then the report has the line "BLOCKED T2 by T1"
    And the report has no READY line for "T2"

  Scenario: A ticket that depends on a dropped ticket says so
    Given the fake tree has these tickets:
      | id | deps | touches | cpu   | status  |
      | T1 |      | docs/a/ | light | dropped |
      | T2 | T1   | docs/b/ | light | todo    |
    When the dag tool runs on the fake tree
    Then the report has the line "BLOCKED T2 by T1 (dropped)"
    And the report has no READY line for "T2"

  Scenario Outline: A ticket can depend on a phase or an integration point
    Given the fake tree has these features:
      | folder           | phase | status   |
      | 10-desktop-shell | 1     | <phase>  |
    And the next file of "10-desktop-shell" says "**phase-1**:無 gate。"
    And the fake tree has these tickets:
      | id | deps                   | touches | cpu   | status |
      | T2 | <dependency>           | docs/b/ | light | todo   |
    When the dag tool runs on the fake tree
    Then the report has the line "<line>"

    Examples:
      | phase | dependency                 | line                                        |
      | done  | 10-desktop-shell/phase-1   | READY T2                                    |
      | todo  | 10-desktop-shell/phase-1   | BLOCKED T2 by 10-desktop-shell/phase-1      |
      | done  | I4                         | BLOCKED T2 by I4                            |

  Scenario Outline: A header with a missing field is a problem and turns the check red
    Given the ticket file "T9-example.md" has a valid header except that "<field>" is missing
    When the dag check runs on the fake tree
    Then it exits with status 1
    And the report has the line "PROBLEM bad-header T9 missing <field>"
    And the summary line says "problems=1"

    Examples:
      | field      |
      | deps       |
      | touches    |
      | cpu        |
      | budget_usd |
      | status     |
      | owner      |
      | must_catch |

  Scenario: A header without an id is named by its file
    Given the ticket file "T9-example.md" has a valid header except that "id" is missing
    When the dag check runs on the fake tree
    Then it exits with status 1
    And the report has the line "PROBLEM bad-header T9-example.md missing id"

  Scenario Outline: A header with an invalid value is a problem and turns the check red
    Given the ticket file "T9-example.md" has a valid header except that "<field>" is "<value>"
    When the dag check runs on the fake tree
    Then it exits with status 1
    And the report has the line "PROBLEM bad-header T9 invalid <field>"

    Examples:
      | field      | value   |
      | cpu        | medium  |
      | status     | wip     |
      | budget_usd | -1      |
      | budget_usd | five    |
      | deps       | T1      |
      | touches    | docs/   |
      | must_catch | none    |
      | owner      | intern  |

  Scenario: An id that cannot be a variable name is a problem and the file names it
    Given the ticket file "T9-example.md" has a valid header except that "id" is "2nd-ticket"
    When the dag check runs on the fake tree
    Then it exits with status 1
    And the report has the line "PROBLEM bad-header T9-example.md invalid id"

  Scenario Outline: A budget of zero is only allowed for tickets that are finished
    Given the fake tree has these tickets:
      | id | deps | touches | cpu   | status   | budget_usd |
      | T9 |      | docs/a/ | light | <status> | 0          |
    When the dag check runs on the fake tree
    Then it exits with status <exit>

    Examples:
      | status     | exit |
      | merged     | 0    |
      | dropped    | 0    |
      | todo       | 1    |
      | dispatched | 1    |
      | review     | 1    |

  Scenario: A dependency that names nothing is a problem
    Given the fake tree has these tickets:
      | id | deps | touches | cpu   | status |
      | T9 | T404 | docs/a/ | light | todo   |
    When the dag check runs on the fake tree
    Then it exits with status 1
    And the report has the line "PROBLEM unresolved-ref T9 T404"
    And the report has no READY line for "T9"

  Scenario: Two tickets with the same id are a problem
    Given the fake tree has these tickets:
      | id | deps | touches | cpu   | status |
      | T1 |      | docs/a/ | light | todo   |
      | T1 |      | docs/b/ | light | todo   |
    When the dag check runs on the fake tree
    Then it exits with status 1
    And the report has the line "PROBLEM duplicate-id T1"

  Scenario: A cycle between tickets turns the check red
    Given the fake tree has these tickets:
      | id | deps | touches | cpu   | status |
      | T1 | T2   | docs/a/ | light | todo   |
      | T2 | T1   | docs/b/ | light | todo   |
    When the dag check runs on the fake tree
    Then it exits with status 1
    And the report has the line "PROBLEM cycle T1 -> T2 -> T1"
    And the report has no READY line for "T1"

  Scenario: The same problems are only reported when the check flag is not given
    Given the fake tree has these tickets:
      | id | deps | touches | cpu   | status |
      | T9 | T404 | docs/a/ | light | todo   |
    When the dag tool runs on the fake tree
    Then it exits with status 0
    And the report has the line "PROBLEM unresolved-ref T9 T404"

  Scenario: Two dispatched tickets that land in the same place are a problem
    Given the fake tree has these tickets:
      | id | deps | touches                    | cpu   | status     |
      | T1 |      | apps/desktop/src-tauri/    | light | dispatched |
      | T2 |      | apps/desktop/src/          | light | dispatched |
    When the dag check runs on the fake tree
    Then it exits with status 1
    And the report has the line "PROBLEM r2-overlap T1 T2 on 10-desktop-shell"

  Scenario: Two dispatched tickets that both land in infra but touch different files do not collide
    Given the fake tree has these tickets:
      | id | deps | touches         | cpu   | status     |
      | T1 |      | scripts/mutate.ts | light | dispatched |
      | T2 |      | scripts/dag.ts  | light | dispatched |
    When the dag check runs on the fake tree
    Then it exits with status 0
    And the report has the line "LANDING T1 infra"
    And the report has the line "LANDING T2 infra"
    And the report has no line starting with "PROBLEM r2-overlap"

  Scenario Outline: Two dispatched tickets in infra collide only when the files are the same or one is a directory above the other
    Given the fake tree has these tickets:
      | id | deps | touches   | cpu   | status     |
      | T1 |      | <first>   | light | dispatched |
      | T2 |      | <second>  | light | dispatched |
    When the dag check runs on the fake tree
    Then it exits with status 1
    And the report has the line "PROBLEM r2-overlap T1 T2 on infra:<shared>"

    Examples:
      | first             | second            | shared            |
      | scripts/mutate.ts | scripts/mutate.ts | scripts/mutate.ts |
      | scripts/          | scripts/mutate.ts | scripts/          |
      | scripts/mutate.ts | scripts/          | scripts/          |

  Scenario: A ready ticket in infra is held only by a ticket on the same file
    Given the fake tree has these tickets:
      | id | deps | touches           | cpu   | status     |
      | T1 |      | scripts/mutate.ts | light | dispatched |
      | T2 |      | scripts/mutate.ts | light | todo       |
      | T3 |      | scripts/dag.ts    | light | todo       |
    When the dag tool runs on the fake tree
    Then the report has the line "HELD T2 by R2 with T1"
    And the report has the line "START T3"
    And the report has no HELD line for "T3"

  Scenario: Two dispatched tickets that land in different places are fine
    Given the fake tree has these tickets:
      | id | deps | touches                    | cpu   | status     |
      | T1 |      | apps/desktop/src-tauri/    | light | dispatched |
      | T2 |      | scripts/dag.ts             | light | dispatched |
    When the dag check runs on the fake tree
    Then it exits with status 0
    And the report has no line starting with "PROBLEM r2-overlap"

  Scenario Outline: A ticket in review keeps its landing until it is merged or dropped
    Given the fake tree has these tickets:
      | id | deps | touches                 | cpu   | status   |
      | T1 |      | apps/desktop/src-tauri/ | light | <first>  |
      | T2 |      | apps/desktop/src/       | light | <second> |
    When the dag check runs on the fake tree
    Then it exits with status <exit>

    Examples:
      | first  | second     | exit |
      | review | dispatched | 1    |
      | review | review     | 0    |
      | merged | dispatched | 0    |
      | dropped| dispatched | 0    |

  Scenario: A ready ticket is held while another ticket in review sits on the same landing
    Given the fake tree has these tickets:
      | id | deps | touches                 | cpu   | status |
      | T1 |      | apps/desktop/src-tauri/ | light | review |
      | T2 |      | apps/desktop/src/       | light | todo   |
    When the dag tool runs on the fake tree
    Then the report has the line "HELD T2 by R2 with T1"
    And the report has no START line for "T2"

  Scenario: The longest matching prefix decides the landing
    Given the fake tree has these tickets:
      | id | deps | touches                          | cpu   | status     |
      | T1 |      | packages/core/src/scheduler/due.ts | light | dispatched |
      | T2 |      | packages/core/src/ingest/        | light | dispatched |
    When the dag check runs on the fake tree
    Then it exits with status 0
    And the report has the line "LANDING T1 04-scheduler"
    And the report has the line "LANDING T2 core"
    And the report has no line starting with "PROBLEM r2-overlap"

  Scenario: A directory path covers every landing beneath it
    Given the landing table also has the row "scripts/due.ts" to "04-scheduler"
    And the fake tree has these tickets:
      | id | deps | touches       | cpu   | status     |
      | T1 |      | scripts/      | light | dispatched |
      | T2 |      | scripts/due.ts | light | dispatched |
    When the dag check runs on the fake tree
    Then it exits with status 1
    And the report has the line "PROBLEM r2-overlap T1 T2 on 04-scheduler"

  Scenario: A header may write a list on one line or one item per line
    Given the ticket file "T9-example.md" has a valid header whose "must_catch" is written one item per line with commas inside the items
    And the same header writes "deps" and "touches" as lists on one line followed by a comment
    When the dag check runs on the fake tree
    Then it exits with status 0
    And the report has no line starting with "PROBLEM"

  Scenario Outline: A ticket that lands in contracts runs alone
    Given the fake tree has these tickets:
      | id | deps | touches    | cpu   | status     |
      | T1 |      | contracts/ | light | dispatched |
      | T2 |      | <touches>  | light | <status>   |
    When the dag check runs on the fake tree
    Then it exits with status <exit>

    Examples:
      | touches  | status     | exit |
      | docs/b/  | dispatched | 1    |
      | docs/b/  | review     | 1    |
      | docs/b/  | todo       | 0    |

  Scenario: A path that matches no landing is a problem
    Given the fake tree has these tickets:
      | id | deps | touches       | cpu   | status |
      | T9 |      | somewhere/new/ | light | todo   |
    When the dag check runs on the fake tree
    Then it exits with status 1
    And the report has the line "PROBLEM no-landing T9 somewhere/new/"

  Scenario Outline: Only one heavy ticket may be dispatched or in review at a time
    Given the fake tree has these tickets:
      | id | deps | touches  | cpu     | status     |
      | T1 |      | docs/a/  | heavy   | <first>    |
      | T2 |      | scripts/ | <cpu>   | <second>   |
    When the dag check runs on the fake tree
    Then it exits with status <exit>

    Examples:
      | first      | second     | cpu   | exit |
      | dispatched | dispatched | heavy | 1    |
      | dispatched | review     | heavy | 1    |
      | review     | review     | heavy | 1    |
      | dispatched | dispatched | light | 0    |
      | dispatched | todo       | heavy | 0    |
      | merged     | dispatched | heavy | 0    |

  Scenario: A ready ticket that would break a rule is held back and the check stays green
    Given the fake tree has these tickets:
      | id | deps | touches                 | cpu   | status     |
      | T1 |      | apps/desktop/src-tauri/ | light | dispatched |
      | T2 |      | apps/desktop/src/       | light | todo       |
    When the dag check runs on the fake tree
    Then it exits with status 0
    And the report has the line "HELD T2 by R2 with T1"
    And the report has no START line for "T2"

  Scenario: A heavy ticket waits while another heavy ticket is running
    Given the fake tree has these tickets:
      | id | deps | touches  | cpu   | status     |
      | T1 |      | docs/a/  | heavy | review     |
      | T2 |      | scripts/ | heavy | todo       |
    When the dag tool runs on the fake tree
    Then the report has the line "HELD T2 by R3 with T1"
    And the report has no START line for "T2"

  Scenario: A fourth ticket waits when three are already dispatched
    Given the fake tree has these tickets:
      | id | deps | touches            | cpu   | status     |
      | T1 |      | docs/a/            | light | dispatched |
      | T2 |      | scripts/b.ts       | light | dispatched |
      | T4 |      | apps/desktop/      | light | dispatched |
      | T5 |      | packages/c/        | light | todo       |
    When the dag tool runs on the fake tree
    Then the report has the line "HELD T5 by R4 with T1,T2,T4"
    And the report has no START line for "T5"

  Scenario: Compatible ready tickets all start, in a fixed order
    Given the fake tree has these tickets:
      | id | deps | touches      | cpu   | status |
      | T2 |      | scripts/b.ts | light | todo   |
      | T1 |      | docs/a/      | light | todo   |
    When the dag tool runs on the fake tree
    Then the report has the line "START T1"
    And the report has the line "START T2"
    And the line "START T1" comes before the line "START T2"

  Scenario: Ids are ordered naturally so T2 comes before T10
    Given the fake tree has these tickets:
      | id  | deps | touches      | cpu   | status |
      | T10 |      | scripts/b.ts | light | todo   |
      | T2  |      | docs/a/      | light | todo   |
    When the dag tool runs on the fake tree
    Then the report has the line "START T2"
    And the report has the line "START T10"
    And the line "START T2" comes before the line "START T10"

  Scenario: When two ready tickets cannot run together the lower id starts and the other is held
    Given the fake tree has these tickets:
      | id | deps | touches      | cpu   | status |
      | T1 |      | docs/a/      | heavy | todo   |
      | T2 |      | scripts/b.ts | heavy | todo   |
    When the dag tool runs on the fake tree
    Then the report has the line "START T1"
    And the report has the line "HELD T2 by R3 with T1"

  Scenario: A ready phase is held when two phases are already in progress
    Given the fake tree has these features:
      | folder   | phase | status      |
      | 01-alpha | 1     | in-progress |
      | 02-beta  | 1     | in-progress |
      | 03-gamma | 1     | ready       |
    And the next file of "01-alpha" says "**phase-1**:無 gate。"
    And the next file of "02-beta" says "**phase-1**:無 gate。"
    And the next file of "03-gamma" says "**phase-1**:無 gate。"
    When the dag tool runs on the fake tree
    Then the report has the line "READY 03-gamma/phase-1"
    And the report has the line "HELD 03-gamma/phase-1 by R4 with 01-alpha/phase-1,02-beta/phase-1"
    And the report has no START line for "03-gamma/phase-1"

  Scenario: A ready phase starts when only one other phase is in progress
    Given the fake tree has these features:
      | folder   | phase | status      |
      | 01-alpha | 1     | in-progress |
      | 03-gamma | 1     | ready       |
    And the next file of "01-alpha" says "**phase-1**:無 gate。"
    And the next file of "03-gamma" says "**phase-1**:無 gate。"
    When the dag tool runs on the fake tree
    Then the report has the line "START 03-gamma/phase-1"
    And the report has no HELD line for "03-gamma/phase-1"

  Scenario Outline: A dependency chain that is too long is a warning and not a red check
    Given the fake tree has a chain of tickets T1 to T5 where each depends on the one before and the status of T1 is "<first>"
    When the dag check runs on the fake tree
    Then it exits with status 0
    And the report <has> a line starting with "WARN r5-depth T5"

    Examples:
      | first  | has      |
      | todo   | has      |
      | merged | has no   |

  Scenario: More than three dispatched tickets is a warning and not a red check
    Given the fake tree has these tickets:
      | id | deps | touches       | cpu   | status     |
      | T1 |      | docs/a/       | light | dispatched |
      | T2 |      | scripts/b.ts  | light | dispatched |
      | T3 |      | apps/desktop/ | light | dispatched |
      | T4 |      | packages/c/   | light | dispatched |
    When the dag check runs on the fake tree
    Then it exits with status 0
    And the report has the line "WARN r4-dispatched 4"

  Scenario: The task commands are printed as a runnable script in dependency order and never run
    Given the fake tree has these tickets:
      | id  | deps    | touches      | cpu   | status |
      | T10 | T2      | scripts/c.ts | light | todo   |
      | T2  | T1      | scripts/b.ts | light | todo   |
      | T1  |         | docs/a/      | light | todo   |
      | T0  |         | docs/z/      | light | merged |
    And a stub program named "orca" is first on the path and records every call
    When the dag tool runs on the fake tree with the flag "--orca"
    Then the output has a line that creates the task for "T1" from the file "docs/tickets/T1-example.md" with no dependency variables
    And the output has a line that creates the task for "T2" from the file "docs/tickets/T2-example.md" with the dependency variables "T1"
    And the output has a line that creates the task for "T10" from the file "docs/tickets/T10-example.md" with the dependency variables "T2"
    And the lines for "T1", "T2" and "T10" appear in that order
    And the stub program was never called

  Scenario: Only tickets that are waiting to be started get a task line and finished dependencies are not listed
    Given the fake tree has these tickets:
      | id | deps   | touches       | cpu   | status     |
      | T1 |        | docs/a/       | light | merged     |
      | T2 |        | scripts/b.ts  | light | dispatched |
      | T3 | T1, T2 | apps/desktop/ | light | todo       |
    When the dag tool runs on the fake tree with the flag "--orca"
    Then the output has exactly 1 line that creates a task
    And the output has a line that creates the task for "T3" from the file "docs/tickets/T3-example.md" with no dependency variables

  Scenario: A ticket file without a header is a problem and names the file
    Given the fake tree has a ticket file "T7-old.md" with no header
    When the dag check runs on the fake tree
    Then it exits with status 1
    And the report has the line "PROBLEM missing-header T7-old.md"

  Scenario: The check is part of the chain that check:all runs
    Given the gates configuration of this repository
    And the package file of this repository
    Then the check chain lists "dag:check"
    And the package file has a script named "dag:check"
    And that script runs the dag tool with the check flag
