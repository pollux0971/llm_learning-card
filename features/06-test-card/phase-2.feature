@i3 @test-card @phase-2
Feature: The test card wired to the real modules
  Delete the stubs. The interface now drives the real scheduler and grader and
  reads and writes a real learning directory through the desktop boundary.

  Background:
    Given the desktop application is running against a real learning directory

  Scenario: The card shows exactly what the real scheduler returns
    Given a fixed learning directory and a fixed date
    When the card builds its question list from the real scheduler
    Then the list matches the scheduler's due list in content and order

  Scenario: A file outside the learning directory cannot be reached
    When the interface is made to request a path outside the directory
    Then the request is refused

  Scenario: Answers are written immediately
    Given the person has answered one question
    When the process is killed without a clean exit
    Then that answer is present in the review state on disk

  Scenario: The interface and the terminal agree
    Given the person answers two questions in the interface
    When the review command is run in the terminal
    Then it offers the remaining questions

  Scenario: A grading error still leaves the card untouched
    Given the cloud grader returns an unparseable response twice
    When an apply answer is submitted
    Then the card's stage on disk is unchanged
    And the question remains in the session

  @manual
  Scenario: A full session end to end
    Given five questions are due
    When the person answers all five
    Then the review state on disk reflects every answer
    And reopening the interface shows nothing due
