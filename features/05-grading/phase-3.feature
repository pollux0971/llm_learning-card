@i6 @grading @phase-3
Feature: Offline grading, reconciliation and reteaching
  Being offline should not stop the review, but a local model judging an apply
  answer is a weaker judgement. Those results are provisional and get a second
  opinion later. Generating the shortened reteach card lives here too.

  Scenario: Offline apply grading is served locally and marked
    Given the network is unavailable and a local model is running
    When an apply answer is submitted
    Then it is graded by the local model
    And the grader is recorded as local and provisional
    And it enters the provisional queue

  Scenario: A provisional pass still advances the schedule
    Given an offline grading returned a pass
    When the caller processes the result
    Then the pass transition is applied
    And the history entry is flagged as provisional

  Scenario: Agreement only clears the flag
    Given the local model passed and the cloud review also passes
    When the result is reconciled
    Then the history entry is no longer flagged provisional
    And the stage is unchanged
    And the log records that nothing changed

  Scenario: A local pass overturned by the cloud rolls back
    Given a card advanced from stage 2 to stage 3 on a provisional pass
    And the cloud review returns a fail
    When the result is reconciled
    Then the fail transition is applied
    And the stage returns to 1
    And the history entry records that the cloud revised it
    And the log records that the outcome changed

  Scenario: A local fail overturned by the cloud is restored
    Given a card fell back to stage 1 on a provisional fail
    And the cloud review returns a pass
    When the result is reconciled
    Then the stage is restored to what it should have reached
    And the consecutive failure count is reduced by one
    And any reteach queued by that failure is removed if it has not been shown

  Scenario: A card reviewed again since is not retroactively changed
    Given a provisional result exists for a card
    And a newer review has been recorded for it
    When the result is reconciled
    Then only the provisional flag and the reviser are updated
    And the stage is left alone
    And the log records that the correction was skipped

  Scenario: A shortened card is generated for reteaching
    Given a card is queued for reteach
    And the network is available
    When the shortened version is generated
    Then a model call is made for the reteach task
    And the prompt contains the original body and examples
    And the produced body is within the short limit
    And it contains exactly one example
    And it is written alongside the original card

  Scenario: An overlong shortened card is regenerated
    Given the first attempt exceeds the short limit
    When the shortened version is generated
    Then it is regenerated until it fits or three attempts are used
    And if all three are too long the shortest is kept and a warning is logged

  Scenario: An offline shortened card is marked provisional
    Given the network is unavailable
    When the shortened version is generated
    Then the file is marked provisional
    And it enters the provisional queue
