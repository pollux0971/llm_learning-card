@i2 @grading @phase-2
Feature: Apply questions judged against a rubric
  Apply questions test transfer, and only a model can judge that. The rubric
  makes the judgement decomposable: passing is not a feeling, it is each
  criterion being met or not.

  Background:
    Given an apply question with three rubric criteria
    And the network is available

  Scenario: The call carries the question, the rubric and the answer
    When an answer is submitted
    Then a model call is made for the apply grading task
    And the prompt contains the question, every rubric line and the answer
    And the response is required to be JSON with one verdict per criterion

  Scenario: All criteria met is a pass
    Given the model returns all three criteria as met
    When grading completes
    Then the answer passes
    And the grader is recorded as the cloud

  Scenario: One criterion unmet fails and says which
    Given the model returns the second criterion as unmet
    When grading completes
    Then the answer fails
    And the feedback refers to the second criterion

  Scenario: Feedback is kept to one short line
    Given the model returns sixty words of feedback
    When grading completes
    Then the feedback is truncated to the contract limit
    And the truncation is logged

  Scenario: An unparseable response is retried once
    Given the model returns something that is not JSON on the first attempt
    And valid JSON on the second
    When grading completes
    Then the second response is used
    And one retry is logged

  Scenario: Two failures leave the card untouched
    Given the model returns something unparseable twice
    When grading completes
    Then the grader is recorded as an error
    And the pass value is null
    And the caller must not advance or roll back the stage

  Scenario: A verdict count that does not match the rubric is invalid
    Given the rubric has three criteria
    And the model returns two verdicts
    When grading completes
    Then the response is treated as invalid and retried

  Scenario: An empty answer never reaches the model
    When the person submits only whitespace
    Then the answer fails
    And the grader is recorded as empty
    And no model call is made

  Scenario: The result shape matches the contract
    When any apply question is graded
    Then the result contains pass, criteria, feedback and grader

  @manual @llm
  Scenario: An obviously right and an obviously wrong answer
    When a correct explanation and a nonsense reply are each submitted
    Then the first passes and the second fails
    And the feedback on the second says what was missing rather than being dismissive
