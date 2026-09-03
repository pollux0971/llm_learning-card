@integration @i2
Feature: A working spaced repetition loop in the terminal
  This is the point where the system becomes genuinely useful. A person can sit
  down every day, be shown what is due, answer it, and have the schedule move
  forward correctly. There is no window yet — that is I3 — but the thing that
  matters is already working.

  If the project stopped here it would still be worth having.

  Background:
    Given a learning directory populated by the I1 pipeline
    And the settings have daily_cap 10

  @e2e
  Scenario: A person completes a review session and the schedule advances
    Given 3 cards are due today
    When the person runs the review command
    And answers the first card correctly
    And answers the second card correctly
    And answers the third card incorrectly
    Then the first two cards have advanced one stage
    And the third card is back at stage 1 and due tomorrow
    And "state/reviews.json" reflects all three outcomes
    And the session prints a summary of 2 passed and 1 returned

  @e2e
  Scenario: Reviewing on consecutive days follows the fixed skeleton
    Given a card was learned 1 day ago and is at stage 1
    When the person reviews it and passes on day 1
    And the clock advances 7 days
    Then that card appears in the due list
    And it is asked as an apply question in addition to a fill question

  Scenario: Question type follows the stage
    Given cards at stage 1, 2 and 3 are all due
    When the review command builds the session
    Then the stage 1 card is asked as fill only
    And the stage 2 card is asked as fill and apply
    And the stage 3 card is asked as apply only

  Scenario: Fill answers are graded without any LLM call in the common case
    Given a fill question whose answer is "protocol"
    When the person answers "Protocol"
    Then the answer is accepted
    And no LLM call is recorded in the log

  Scenario: Apply answers are graded against the rubric
    Given an apply question with 3 rubric criteria
    When the person submits an answer that satisfies all 3
    Then the answer is accepted
    And the grader is recorded as cloud
    And the feedback is at most 40 words

  Scenario: Grading works without any fake in the loop
    Given the fake router fixtures directory is renamed away
    When an apply question is graded
    Then it is still graded correctly

  Scenario: The daily cap is respected and the rest defer
    Given 15 cards are due today
    When the person runs the review command
    Then exactly 10 questions are presented
    And the remaining 5 are reported as deferred
    And the deferred cards keep their existing state

  Scenario: The most fragile memories are asked first
    Given a stage 1 card overdue by 1 day
    And a stage 5 card overdue by 2 days
    When the session is built
    Then the stage 1 card is presented before the stage 5 card

  Scenario: Two consecutive failures queue a reteach
    Given a card has failed once and is due
    When the person answers it incorrectly again
    Then the card is queued for reteach
    And the reteach does not consume the daily cap

  Scenario: A grading error leaves the card untouched
    Given the cloud grader returns an unparseable response twice
    When the person submits an apply answer
    Then the card's stage is unchanged
    And the card remains in today's list
    And the session reports that grading failed

  Scenario: The session can be interrupted and resumed
    Given 5 cards are due and the person answered 2
    When the person quits and runs the review command again the same day
    Then the session resumes at the third card
    And the same 5 cards are used

  @regression
  Scenario: The content pipeline still works as in I1
    When the person ingests a new raw file
    Then cards, questions and order are produced as in I1

  Scenario: Every standalone entry point still runs
    When every non interactive command in the standalone manifest is executed
    Then each exits with status 0
    And each output contains the expected marker

  @manual
  Scenario: A person actually uses it for a week
    When the person runs the review command daily for seven days
    Then cards learned on day one come back on day two
    And cards passed on day two come back seven days later
    And nothing in state/reviews.json looks wrong on inspection
