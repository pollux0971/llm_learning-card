@i1 @data-layer @phase-2
Feature: Question, state, log and configuration formats
  The four file formats other than cards. Questions are pregenerated at ingest
  so they must be validatable; state and log are the ground under scheduler and
  weekly-goal; configuration holds every tunable value in one place.

  Scenario: Every card must have a question file with the same id
    Given a card exists with no matching question file
    When the consistency check runs
    Then it reports the missing question file for that card

  Scenario: A question file needs at least two fill and one apply question
    Given a question file with one fill and no apply question
    When the validator runs
    Then the result is a failure
    And the error mentions both shortfalls

  Scenario: Blank counts must match answer groups
    Given a fill question whose prompt has three blanks
    And only two answer groups
    When the validator runs
    Then the result is a failure
    And the error reports three blanks against two groups

  Scenario: An answer group must not be empty
    Given a fill question with an empty answer group
    When the validator runs
    Then the result is a failure

  Scenario Outline: Rubric length is bounded
    Given an apply question with <n> rubric criteria
    When the validator runs
    Then the result is <result>

    Examples:
      | n | result  |
      | 1 | failure |
      | 2 | pass    |
      | 4 | pass    |
      | 5 | failure |

  Scenario Outline: Stage must be within range
    Given a review entry with stage <stage>
    When the validator runs
    Then the result is <result>

    Examples:
      | stage | result  |
      | 0     | pass    |
      | 6     | pass    |
      | 7     | failure |
      | -1    | failure |

  Scenario: An archived card has no next due date
    Given a review entry at stage 6
    When the validator runs
    Then next_due must be null
    And a non null next_due at stage 6 is a failure

  Scenario: A newly learned card gets the contract's initial state
    Given a card that has no review entry
    When it is marked learned on 2026-09-02
    Then the initial stage is 1
    And learned_at is 2026-09-02
    And next_due is 2026-09-03
    And both failure counters are zero
    And stuck is false
    And history is empty

  Scenario: Each log line is a standalone JSON object
    When a learned event is recorded for a card
    Then the last line of the log parses as JSON
    And it contains a timestamp, a type and a card id

  Scenario Outline: Event types are a closed set
    When an event of type <type> is recorded
    Then the result is <result>

    Examples:
      | type                 | result  |
      | learned              | pass    |
      | reviewed             | pass    |
      | ingested             | pass    |
      | llm_call             | pass    |
      | week_rolled          | pass    |
      | provisional_resolved | pass    |
      | not_a_real_type      | failure |

  Scenario: A category needs an id, a name and a raw requirement flag
    Given a category entry missing the raw requirement flag
    When the validator runs
    Then the result is a failure

  Scenario: Settings defaults match the contract
    When a freshly initialised settings file is read
    Then the daily cap is 10
    And the weekly target is 7
    And the short body limit is 50
    And the llm section contains a cloud provider, a cloud model and a local model

  Scenario Outline: Settings values are bounded
    Given a settings file where <key> is <value>
    When the validator runs
    Then the result is failure

    Examples:
      | key           | value |
      | daily_cap     | 0     |
      | daily_cap     | -3    |
      | weekly_target | 0     |
      | weekly_target | 1.5   |

  Scenario: State writes are atomic
    When the review state is written
    Then a temporary file is written and renamed into place
    And no partial file is ever visible at the target path

  Scenario: A write interrupted part way leaves the old file intact
    Given the review state contains one entry
    When a write is interrupted before the rename
    Then the existing file still contains that entry
    And a stray temporary file is cleaned up on the next write

  Scenario: The log is appended one whole line at a time
    When two events are recorded in quick succession
    Then the log contains two complete lines
    And neither line is interleaved with the other
