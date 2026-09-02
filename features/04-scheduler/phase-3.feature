@i2 @scheduler @phase-3
Feature: The daily cap and overdue ratio ordering
  Learning volume is under the person's control, so review volume needs a
  ceiling. Within that ceiling, what gets asked first is decided by how overdue
  a card is relative to its own interval — not by how many days have passed.

  A stage one card one day late has lost the whole interval. A stage five card
  one day late has lost half a percent. The first one is the fragile memory.

  Background:
    Given the daily cap is 10

  Scenario: More due than the cap takes only the cap
    Given 15 cards are due today
    When the session is selected
    Then 10 are returned
    And 5 are reported as deferred
    And the deferred cards keep their state

  Scenario: Fewer due than the cap takes all of them
    Given 4 cards are due today
    When the session is selected
    Then 4 are returned
    And none are deferred

  Scenario Outline: The overdue ratio is days late over the stage interval
    Given a card at stage <stage> that is <late> days late
    When the ratio is computed
    Then it is approximately <ratio>

    Examples:
      | stage | interval | late | ratio |
      | 1     | 1        | 1    | 1.000 |
      | 1     | 1        | 3    | 3.000 |
      | 2     | 7        | 1    | 0.143 |
      | 3     | 30       | 3    | 0.100 |
      | 4     | 90       | 9    | 0.100 |
      | 5     | 180      | 1    | 0.006 |

  Scenario: A card due exactly today has a ratio of zero
    Given a card due today
    When the ratio is computed
    Then it is zero

  Scenario: The most fragile memory is asked first
    Given the following due cards:
      | id       | stage | days_late |
      | sec-0001 | 5     | 2         |
      | sec-0002 | 1     | 1         |
      | sec-0003 | 2     | 2         |
    When the session is selected
    Then the order is sec-0002, sec-0003, sec-0001

  Scenario: Equal ratios break by how long ago the card was learned
    Given two stage one cards both one day late
    And the first was learned earlier than the second
    When the session is selected
    Then the one learned earlier comes first

  Scenario: The cap comes from settings
    Given the daily cap is 5
    And 8 cards are due
    When the session is selected
    Then 5 are returned

  Scenario Outline: An invalid cap is rejected
    Given the daily cap is <cap>
    When the session is selected
    Then an error is raised naming the cap

    Examples:
      | cap |
      | 0   |
      | -1  |

  Scenario: Reteach cards do not consume the cap
    Given 10 cards are due
    And 2 cards are queued for reteach
    When the session is selected
    Then 10 questions are returned
    And the 2 reteach cards are returned separately

  Scenario: Deferred cards are one day more overdue tomorrow
    Given 12 cards were due today and 10 were selected
    When the session is selected the following day
    Then the 2 that were skipped are one day later
    And they take part in the ordering again

  Scenario: The steady state load can be simulated
    When the simulation runs for 200 days learning 2 cards per day
    Then it reports the daily question count over time
    And it reports how often the cap was reached
