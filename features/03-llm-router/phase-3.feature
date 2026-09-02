@i6 @llm-router @phase-3
Feature: The provisional queue
  Results produced by the local model while offline are usable now and verified
  later. This phase owns the queue only; what to do with a reconciled result
  belongs to grading and lint.

  Scenario: A local result enters the queue
    When a deepen call is served locally
    Then an entry is added to the provisional queue
    And it records the task, the card, the time and a hash of the local result

  Scenario: A cloud result does not
    When a deepen call is served by the cloud
    Then the queue is unchanged

  Scenario: One entry per card and task
    Given the queue already holds a grading entry for a card
    When that card is graded locally again
    Then the queue still holds one grading entry for it
    And the timestamp is the newer one

  Scenario: Draining returns the pending work with its prompts
    Given the queue holds three entries
    And the network is available
    When the queue is drained
    Then three entries are returned
    And each carries the original prompt so it can be replayed

  Scenario: Draining offline returns nothing
    Given the queue holds three entries
    And the network is unavailable
    When the queue is drained
    Then nothing is returned
    And the queue is unchanged

  Scenario: Resolving removes the entry and records whether it changed
    Given the queue holds one entry
    When it is resolved with a cloud result
    Then it is removed from the queue
    And a resolved event is logged recording whether the outcome changed

  Scenario: A corrupt queue file does not take the system down
    Given the queue file is not valid JSON
    When any local call happens
    Then the corrupt file is preserved with a backup suffix
    And an empty queue is rebuilt
    And a warning is logged

  Scenario: The queue survives a restart
    Given three entries were queued
    When the process restarts
    Then the queue still holds three entries
