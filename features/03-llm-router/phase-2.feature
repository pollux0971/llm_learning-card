@i1 @llm-router @phase-2
Feature: Offline detection and task routing
  The heart of the local plus cloud decision. One interface, and the provider is
  chosen from the task and the current connectivity. Generation tasks refuse to
  degrade; grading and deepening may fall back and be marked provisional.
  Local-model detection and the local adapter itself are not built yet
  (ADR-037) — this phase's `local` flag is always injected/mocked as unavailable
  in real runs, but the routing table logic is still tested against both states
  so it is correct the day a local model exists.

  Scenario: The local model being absent is not an error
    Given the local model server refuses the connection
    When the local probe runs
    Then it reports the model as unavailable
    And no error is raised

  Scenario: Connectivity is cached briefly
    When the online probe is called twice ten seconds apart
    Then only one real request is made

  Scenario: The cache expires
    When the online probe is called twice ninety seconds apart
    Then two real requests are made

  Scenario Outline: Routing follows the contract table
    Given the network is <online> and the local model is <local>
    When a call is made for the task <task>
    Then the outcome is <outcome>

    Examples:
      | task           | online | local | outcome                     |
      | ingest.cards   | up     | up    | cloud                       |
      | ingest.cards   | down   | up    | error, cloud required       |
      | ingest.deps    | down   | up    | error, cloud required       |
      | deepen         | up     | up    | cloud                       |
      | deepen         | down   | up    | local, marked provisional   |
      | deepen         | down   | down  | error, no model available   |
      | grade.fill.llm | up     | up    | local                       |
      | grade.fill.llm | up     | down  | error, no model available   |
      | grade.apply    | up     | up    | cloud                       |
      | grade.apply    | down   | up    | local, marked provisional   |
      | reteach.short  | down   | up    | local, marked provisional   |

  Scenario: Changing the routing table changes behaviour everywhere
    Given the routing entry for the deepen task is changed to require the cloud
    When a deepen call is made while offline
    Then it raises the cloud required error
    And no other change was needed to make that happen
