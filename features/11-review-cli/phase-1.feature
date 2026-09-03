@i2 @review-cli @phase-1
Feature: A usable review session in the terminal
  The layer that turns a scheduler and a grader into something a person can sit
  down and use. Thin, but it owns the decisions neither of those modules make:
  when the session is fixed, when answers land, what the summary says.

  This is also the specification for the desktop version. Get it right here and
  the window is just a different skin.

  Background:
    Given a learning directory populated by the I1 pipeline
    And today is "2026-09-10"

  Scenario: Listing what is due without answering anything
    When the review command is run in dry run mode
    Then it prints each due card with its stage and how overdue it is
    And it prints them in the order they would be asked
    And no file is written

  Scenario: Nothing due says so and exits cleanly
    Given no cards are due today
    When the review command is run
    Then it says there is nothing due
    And it exits with status 0

  Scenario: A session asks each due card in order
    Given 3 cards are due
    When the review command is run
    Then the cards are presented in the order the scheduler returned
    And the progress is shown before each question

  Scenario: A fill question is answered on one line
    Given the current question is a fill question with three blanks
    When the person enters three answers separated by commas
    Then each blank is graded separately
    And the fill-question feedback is shown

  Scenario: An apply question is answered across several lines
    Given the current question is an apply question
    When the person enters several lines and ends the input
    Then the whole text is submitted as one answer

  Scenario: A passing answer advances the schedule immediately
    Given a card at stage 1 is being asked
    When the person answers correctly
    Then the review state on disk shows stage 2
    And the change is written before the next question is shown

  Scenario: A failing answer returns the card immediately
    Given a card at stage 3 is being asked
    When the person answers incorrectly
    Then the review state on disk shows stage 1 and due tomorrow

  Scenario: A card at stage two is only resolved after both questions
    Given a card at stage 2 is being asked
    When the fill question is answered correctly
    Then no transition has been written yet
    When the apply question is answered incorrectly
    Then one failure is written
    And the history contains both answers

  Scenario: A grading error leaves the card alone and keeps going
    Given the grader returns an error result for the current question
    When the grading error is handled
    Then no transition is written for that card
    And the session reports that grading failed
    And the session continues to the next question

  Scenario: Answers land one at a time
    Given 5 cards are due and 2 have been answered
    When the process is killed
    Then the review state on disk contains exactly those 2 outcomes

  Scenario: The session ends with a summary
    Given 5 cards were answered with 3 passes and 2 failures
    When the session finishes
    Then the summary reports 3 passed and 2 returned
    And it estimates how many are due tomorrow

  Scenario: The estimate accounts for returns and the cap
    Given 4 cards were already due tomorrow
    And 2 cards were returned today
    When the estimate is computed
    Then it reports 6
    And when that would exceed the daily cap it reports the cap and the overflow

  Scenario: Reteach cards are shown before the questions
    Given 1 card is queued for reteach
    When the review command is run
    Then the shortened version is shown before the first question
    And it is not counted in the progress

  Scenario: A stuck card is flagged when asked
    Given the current card has failed three times in a row
    When it is presented
    Then the output notes the repeated failures

  @manual
  Scenario: The session is pleasant enough to use daily
    When the person runs a real session of five questions
    Then typing an answer and moving on takes no unnecessary keystrokes
    And the feedback is readable without scrolling back
