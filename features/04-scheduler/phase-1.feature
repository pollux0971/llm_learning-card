@wave0 @scheduler @phase-1 @standalone
Feature: The fixed interval skeleton
  Five checkpoints, fixed gaps, no algorithm. This phase covers only the path
  where the person answers correctly. Everything here is a pure function over
  the review state, so it depends on nothing at all.

  Scenario: The due list runs on its own
    When the standalone due command is run against a fixture state
    Then it exits with status 0
    And it prints the cards due on the given date

  Scenario: A newly learned card is due tomorrow
    Given a card marked learned on 2026-09-02
    When the learned transition is applied
    Then its stage is 1
    And it is due on 2026-09-03

  Scenario Outline: Passing advances the stage by the contract interval
    Given a card at stage <from>
    And today is 2026-09-10
    When the pass transition is applied
    Then its stage becomes <to>
    And it is next due on <due>

    Examples:
      | from | to | due        | gap  |
      | 1    | 2  | 2026-09-17 | 7    |
      | 2    | 3  | 2026-10-10 | 30   |
      | 3    | 4  | 2026-12-09 | 90   |
      | 4    | 5  | 2027-03-09 | 180  |

  Scenario: Passing the last checkpoint archives the card
    Given a card at stage 5
    When the pass transition is applied
    Then its stage becomes 6
    And it has no next due date

  Scenario: An archived card never appears again
    Given a card at stage 6
    When the due list is built for any date
    Then that card is not included

  Scenario Outline: The stage determines the question types
    Given a card at stage <stage>
    When the question types are requested
    Then they are <types>

    Examples:
      | stage | types      |
      | 1     | fill       |
      | 2     | fill,apply |
      | 3     | apply      |
      | 4     | apply      |
      | 5     | apply      |

  Scenario: The due list includes only cards at or past their date
    Given the following review state:
      | id       | stage | next_due   |
      | sec-0001 | 1     | 2026-09-10 |
      | sec-0002 | 2     | 2026-09-09 |
      | sec-0003 | 3     | 2026-09-11 |
      | sec-0004 | 6     |            |
      | sec-0005 | 0     | 2026-09-10 |
    And today is 2026-09-10
    When the due list is built
    Then it contains sec-0001 and sec-0002 only

  Scenario: Passing appends to the history
    Given a card at stage 1
    When it passes a fill question graded exactly
    Then a history entry records the date, the stage, the type, a pass and the grader

  Scenario: The transitions never mutate their input
    Given a review state object
    When the pass transition is applied
    Then the original object is unchanged
    And a new object is returned

  Scenario: Dates are handled as plain calendar days
    Given a card due on 2026-03-29 in a timezone that changes offset that day
    When the interval is added
    Then the result is the same as in any other timezone
