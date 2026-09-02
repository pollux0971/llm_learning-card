@i3 @review-cli @phase-2
Feature: Session boundaries
  What happens when the person walks away half way through, comes back the next
  day, or decides today is not happening. These are the details that only become
  obvious after a week of real use.

  Background:
    Given a learning directory in daily use

  Scenario: The day's question set is fixed once the session starts
    Given the session was created this morning with 10 questions
    And more cards have become due since
    When the review command is run again today
    Then the same 10 questions are used
    And the newly due cards are left for tomorrow

  Scenario: An interrupted session resumes where it stopped
    Given 5 questions were due and 2 were answered before quitting
    When the review command is run again the same day
    Then it resumes at the third question
    And the progress shows two of five

  Scenario: Crossing midnight rebuilds the set
    Given 3 questions were left unanswered yesterday
    When the review command is run today
    Then the session is rebuilt from scratch
    And yesterday's three are one day more overdue
    And yesterday's session cache is removed

  Scenario: A corrupt session cache is discarded rather than fatal
    Given the session cache for today is not valid JSON
    When the review command is run
    Then the cache is rebuilt
    And a warning is logged
    And the already recorded answers in the review state are respected

  Scenario: Pausing today records nothing
    When the review command is run with the pause option
    Then no card is recorded as failed
    And the session cache marks the day as paused
    And running the command again says the day is paused

  Scenario: Unpausing the same day restores the session
    Given today was paused
    When the review command is run with the unpause option
    Then the original question set is restored
    And answering continues normally

  Scenario: Answers already recorded are never asked twice
    Given a card was answered this morning
    When the session is rebuilt for any reason
    Then that card is not asked again today

  Scenario: The dry run reflects the real session
    Given a session already exists for today with 2 of 5 answered
    When the review command is run in dry run mode
    Then it lists the remaining 3 questions
    And it does not modify the cache
