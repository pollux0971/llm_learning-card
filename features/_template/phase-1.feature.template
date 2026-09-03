@wave0 @name @phase-1 @standalone
Feature: (one line: what this phase delivers)
  (Two or three lines: why this exists and where it sits in the whole.
  For phase-1, state explicitly that it runs without any other module.)

  Background:
    Given (shared precondition, fixtures only)

  Scenario: The module runs on its own
    When the standalone command is executed against a fixture
    Then it exits with status 0
    And it prints (something specific)

  Scenario: (what happens when)
    Given (precondition)
    When (action)
    Then (observable result)
    And (second observable result)

  Scenario Outline: (for variants)
    Given an input of <input>
    When the action runs
    Then the result is <output>

    Examples:
      | input | output |
      |       |        |

  @manual
  Scenario: (needs human eyes)
    When (action)
    Then (what you should see)
