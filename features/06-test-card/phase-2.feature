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

  Scenario: The review helper takes only review actions
    When the window sends the review helper an action other than start, next, submit, summary or status
    Then the action is refused
    And the helper keeps running
    And no action the window can send carries a path or a card id

  Scenario: The helper's message shape is the same on both sides
    When the shared message vectors are read by the window side and by the desktop shell
    Then both accept and refuse exactly the same lines

  Scenario: A helper that has exited is reported and the next action starts a new one
    Given the review helper has exited
    When the window sends an action
    Then the window is told the helper has exited
    And the action after that is answered by a new helper

  Scenario: The fake grader can only be turned on when the application starts
    Given the application was started without the fake grader variable
    When the window sends any action
    Then the grading stays real
    And a release build drops the fake grader variable before starting the helper

  @manual
  Scenario: The helper does not outlive the application
    When the application is closed, or killed
    Then no review helper process is left running

  @manual
  Scenario: A full session end to end
    Given five questions are due
    When the person answers all five
    Then the review state on disk reflects every answer
    And reopening the interface shows nothing due
