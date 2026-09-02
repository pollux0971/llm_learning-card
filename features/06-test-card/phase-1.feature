@wave0 @test-card @phase-1 @standalone
Feature: The test card interface running against fixtures
  Everything a person sees while being tested, with stubbed logic behind it.
  Running in a browser against recorded fixtures means the whole interface can
  be built and judged before any of the real modules exist.

  The stubs must match the contract signatures exactly, because integration is
  meant to be a deletion, not a rewrite.

  Background:
    Given the development server is running against the rich fixture set
    And three questions are due

  Scenario: The interface runs on its own
    When the standalone dev command is run
    Then the server starts
    And opening it shows the first question
    And no network request leaves the machine

  @manual
  Scenario: The header shows how far through the session the person is
    When the interface loads
    Then the header shows zero of three

  @manual
  Scenario: An empty day says so
    Given no questions are due
    When the interface loads
    Then it says there is nothing due today
    And no input is shown

  @manual
  Scenario: A fill question shows one input per blank
    Given the current question is a fill question with three blanks
    When it is displayed
    Then each blank is shown as an underlined slot
    And there is one single line input per blank
    And the first input has focus

  @manual
  Scenario: An apply question shows a multi line input
    Given the current question is an apply question
    When it is displayed
    Then the full question text is shown
    And a multi line input at least five rows tall is shown

  Scenario: Enter submits a fill question
    Given the current question is a fill question
    When the person presses enter
    Then the stub grader is called with the typed answers

  Scenario: Enter inserts a newline in an apply question
    Given the current question is an apply question
    When the person presses enter
    Then nothing is submitted
    And a newline is added to the input

  Scenario: An apply question is submitted with a modifier
    Given the current question is an apply question
    When the person presses the submit shortcut
    Then the stub grader is called with the typed answer

  @manual
  Scenario: The result is shown with a single line of feedback
    When an answer has been graded
    Then the interface shows whether it passed
    And it shows one line of feedback
    And a failed fill question also shows the correct answer
    And a next button appears

  @manual
  Scenario: Waiting for a slow grade is visible
    Given the stub grader is configured to take four seconds
    When an apply answer is submitted
    Then the submit control is disabled
    And a loading indicator is shown
    And after a few seconds it says grading is still running

  Scenario: A grading error leaves the question in place
    Given the stub grader returns an error result
    When the person submits an answer
    Then no scheduler transition is applied
    And the interface says grading failed and to try again
    And the question stays in the session

  @manual
  Scenario: Moving to the next question
    When the person presses next
    Then the following question is shown
    And the header count increases by one

  @manual
  Scenario: A stage two card asks both question types
    Given the current card is at stage 2
    When it is displayed
    Then the fill question comes first and the apply question second
    And no transition is applied until both are answered

  Scenario: The stubs are drop in replaceable
    Given the stub scheduler is swapped for the real one from the core package
    When the interface loads
    Then it compiles and runs without any change to the interface code
