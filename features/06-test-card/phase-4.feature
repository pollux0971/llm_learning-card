@i5 @test-card @phase-4
Feature: Reteaching before the questions
  A card that has been missed twice in a row gets shown again in a different,
  shorter form before the session starts. It is not a question and it does not
  use up the daily allowance.

  Background:
    Given one card is queued for reteach

  @manual
  Scenario: The review block appears before the first question
    When the interface loads
    Then a review block is shown above the first question
    And it notes that this card has been missed twice

  Scenario: A missing shortened version is generated
    Given no shortened file exists for that card
    When the interface loads
    Then the shortened version is generated
    And a loading state is shown while it is produced
    And it is displayed when it is ready

  Scenario: An existing shortened version is reused
    Given a shortened file already exists for that card
    When the interface loads
    Then no model call is made
    And the existing file is rendered

  @manual
  Scenario: The shortened version is genuinely shorter
    When the review block is displayed
    Then the body is within the short limit
    And exactly one example is shown
    And a provisional version is marked as awaiting review

  Scenario: Acknowledging removes it from the queue
    When the person acknowledges the review block
    Then the card leaves the reteach queue
    And a viewed event is logged
    And the first question is shown

  Scenario: Closing without acknowledging keeps it queued
    When the person closes the interface without acknowledging
    Then the card is still queued
    And it is shown again next time

  Scenario: Several queued cards are shown in turn
    Given three cards are queued for reteach
    When the interface loads
    Then three review blocks are shown in sequence
    And each is acknowledged separately

  Scenario: Reteaching does not affect the question count
    Given ten questions are due and two cards are queued for reteach
    When the interface loads
    Then the header shows zero of ten
    And the review blocks are not counted
