@llm-router @phase-4
Feature: The local model adapter
  Talking to a real local model server. Split out of phase-2 by ADR-037: the
  routing table logic is already tested and correct, but nothing here can be
  exercised for real until the user decides to install a local model — this
  phase's gate is that decision, not an integration point number.

  Scenario: The local model is detected when it is running
    Given the local model server responds
    When the local probe runs
    Then it reports the model as available
    And it returns the list of installed models

  Scenario: The local model name comes from settings
    Given the settings name a particular local model
    When a local call is made
    Then the request names that model

  Scenario: A local call that fails does not fall through to the cloud
    Given the local model is available but returns an error
    When a call is made for the fill grading task
    Then the error is surfaced
    And no cloud call is made

  @manual
  Scenario: Deepening still works with the network unplugged
    Given a local model is running
    When the network is disconnected and a deepen call is made
    Then a result returns within a few seconds
    And it is marked provisional
</content>
