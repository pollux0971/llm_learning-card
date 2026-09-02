@wave0 @weekly-goal @phase-1 @standalone
Feature: Weekly counting with a pass gate
  What counts is a new concept that has survived its first review. Pressing next
  in the teach card is not learning; passing the first checkpoint the next day
  is. This is a pure function over the weekly state and depends on nothing.

  Background:
    Given a weekly state for week 2026-W37 with a target of 7 and both counts at zero

  Scenario: The counter runs on its own
    When the standalone weekly command is run against a fixture with a pass event
    Then it exits with status 0
    And it prints the updated counts and whether the target is met

  Scenario: Learning a card increases only the learned count
    When a learned event arrives
    Then the learned count is one
    And the passed count is still zero

  Scenario: Passing the first checkpoint increases the passed count
    Given a card at the first checkpoint
    When it passes
    Then the passed count is one

  Scenario: Passing a later checkpoint does not count
    Given a card at the second checkpoint
    When it passes
    Then the passed count is unchanged

  Scenario: A card counts at most once in a week
    Given a card already counted this week
    And it later failed and returned to the first checkpoint
    When it passes the first checkpoint again
    Then the passed count is unchanged
    And the card remains in the counted list

  Scenario: A card learned last week counts in the week it passes
    Given a card was learned on the last day of the previous week
    When it passes its first checkpoint on the Monday
    Then this week's passed count increases

  Scenario Outline: Meeting the target
    Given the passed count is <passed> and the target is <target>
    When the target check runs
    Then the result is <met>

    Examples:
      | passed | target | met   |
      | 6      | 7      | false |
      | 7      | 7      | true  |
      | 9      | 7      | true  |

  Scenario: Crossing into a new week resets the counts
    Given the stored week is 2026-W37
    And today falls in 2026-W38
    When any event arrives
    Then a rollover event is logged for the old week
    And the counts reset to zero
    And the counted list is emptied
    And the target is preserved

  Scenario: Missing the target carries no penalty
    Given the previous week reached three of seven
    When the week rolls over
    Then the rollover event records that the target was not met
    And nothing else changes

  Scenario: Skipping several weeks logs one rollover
    Given the stored week is three weeks behind
    When any event arrives
    Then exactly one rollover event is logged for the stored week
    And the state is set to the current week

  Scenario Outline: ISO weeks at the year boundary
    Given the date is <date>
    When the ISO week is computed
    Then it is <week>

    Examples:
      | date       | week      |
      | 2026-12-31 | 2026-W53  |
      | 2027-01-01 | 2026-W53  |
      | 2027-01-04 | 2027-W01  |

  Scenario: The functions never mutate their input
    Given a weekly state object
    When an event is applied
    Then the original object is unchanged
    And a new object is returned
