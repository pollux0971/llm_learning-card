@i5 @grading @phase-3
Feature: Shortened reteach cards
  A card that keeps being missed gets a shorter version to reread before the
  questions. Generating it lives here; showing it belongs to the test card.

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
