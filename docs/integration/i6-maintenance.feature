@integration @i6
Feature: The system survives offline use and stays healthy over time
  Offline days should not stop the person reviewing, but a local model grading
  an apply question is a weaker judgement, so those results are provisional and
  get a second opinion when the network returns. Lint finds what has rotted.

  Background:
    Given the desktop application is running
    And a learning directory with several months of history

  @e2e
  Scenario: A person reviews offline and the results are reconciled later
    Given the network is unavailable and a local model is running
    When the person completes a review session with 3 apply questions
    Then each result is recorded with grader local-provisional
    And each enters the provisional queue
    And the schedule advances as normal
    When the network becomes available
    And the person runs lint with the fix provisional option
    Then each result is re-graded by the cloud
    And any result the cloud disagrees with has its stage corrected
    And the log records whether each one changed

  Scenario: A local pass overturned by the cloud is rolled back
    Given a card advanced from stage 2 to stage 3 on a provisional pass
    When the cloud review returns a fail
    Then the card returns to stage 1
    And the history entry records that the cloud revised it

  Scenario: A local fail overturned by the cloud is restored
    Given a card fell back to stage 1 on a provisional fail
    When the cloud review returns a pass
    Then the card is restored to the stage it should have reached
    And the consecutive failure count is decreased by one

  Scenario: A card reviewed again since is not retroactively corrected
    Given a provisional result exists for a card
    And that card has been reviewed again since
    When the provisional result is resolved
    Then only the provisional marker is updated
    And the stage is left alone

  Scenario: Lint uses the shared validator
    When lint runs
    Then it reports problems using the data-layer validator
    And no minimal validator remains in the lint code

  Scenario: Lint finds what has rotted
    Given a card whose body was manually edited past the limit
    And a card whose question file was deleted
    And a card whose prereq points at something that does not exist
    And a raw file that changed after its cards were generated
    When lint runs
    Then all four problems are listed with card ids and file paths
    And a report is written to the state directory
    And the exit status is non zero

  Scenario: Lint changes nothing unless asked
    When lint runs with no options
    Then the cards, questions, graph and reviews are byte identical to before

  Scenario: Regenerating a card keeps its identity and history
    Given a stuck card with 4 recorded failures
    When the person regenerates it
    Then the id, category, level and created date are unchanged
    And its review history is preserved
    And the consecutive failure count is reset and stuck is cleared
    And the previous version is kept as a backup file

  Scenario: Offline requests that need the cloud refuse cleanly
    Given the network is unavailable
    When the person runs lint with the fix provisional option
    Then it reports that reconciliation needs the cloud
    And the queue is unchanged

  @regression
  Scenario: The daily habit features still work as in I5
    When the machine is restarted and a session is completed from the tray
    Then everything behaves as in I5
