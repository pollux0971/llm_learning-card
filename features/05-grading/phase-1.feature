@wave0 @grading @phase-1 @standalone
Feature: Three layer fill in the blank grading
  Most blanks do not need a model. Try exact, then fuzzy, and only ask a model
  when neither settles it. This keeps the daily review nearly instant and free.

  In Wave 0 the third layer runs against a fake router, so the whole module
  works offline and depends on nothing.

  Scenario: Grading runs on its own
    When the standalone grade command is run with the fill flag against a fixture
    Then it exits with status 0
    And it prints a result containing pass and grader

  Scenario Outline: Normalisation
    Given the person types <input>
    When it is normalised
    Then the result is <output>

    Examples:
      | input       | output   | note                    |
      | " protocol" | protocol | surrounding space       |
      | Protocol    | protocol | case                    |
      | ＰＲＯＴＯＣＯＬ | protocol | full width characters   |
      | 埠　號       | 埠號      | full width space        |

  Scenario Outline: The first layer is an exact match
    Given the accepted answers are 協定, protocol and scheme
    When the person types <input>
    Then the answer passes
    And the grader is recorded as exact

    Examples:
      | input    |
      | 協定      |
      | protocol |
      | PROTOCOL |
      | Scheme   |

  Scenario: The second layer allows one character of slack
    Given the accepted answer is protocol
    When the person types protocl
    Then the answer passes
    And the grader is recorded as fuzzy

  Scenario: Short answers skip the fuzzy layer
    Given the accepted answer is 埠號
    When the person types 埠
    Then the fuzzy layer is not used
    And the third layer is reached

  Scenario: Two characters of difference is not a fuzzy match
    Given the accepted answer is protocol
    When the person types protcl
    Then the fuzzy layer does not match
    And the third layer is reached

  Scenario: The third layer asks a model whether the answer means the same
    Given the accepted answer is 協定
    And neither of the first two layers matched
    When the person types 通訊協定
    Then a model call is made for the fill grading task
    And the prompt contains both the accepted answer and what the person typed

  Scenario: The model accepting the answer passes it
    Given the model replies that the answers mean the same
    When the third layer completes
    Then the answer passes
    And the grader is recorded as the local model

  Scenario: No model available falls back to strict
    Given neither of the first two layers matched
    And no model is available
    When grading completes
    Then the answer fails
    And the grader is recorded as a strict fallback
    And the feedback explains that no fuzzy judgement was possible

  Scenario: An exact match never reaches a model
    Given the accepted answer is protocol
    When the person types protocol
    Then no model call is made

  Scenario: A fuzzy match never reaches a model
    Given the accepted answer is protocol
    When the person types protocl
    Then no model call is made

  Scenario: Every blank in a question is judged separately
    Given a question with three blanks
    When the first two answers are right and the third is wrong
    Then the question fails
    And the feedback names the third blank and gives its answer

  Scenario: An empty answer fails without touching any layer
    When the person submits nothing
    Then the answer fails
    And the grader is recorded as empty
    And no model call is made

  Scenario: The result shape matches the contract
    When any fill question is graded
    Then the result contains pass, feedback and grader
    And the grader is one of the values allowed for fill grading
