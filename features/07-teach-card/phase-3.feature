@i4 @teach-card @phase-3
Feature: Going deeper
  The first two levels are already there. Below that, cards are made when the
  person asks for them — from the cloud when online, from the local model when
  not, and marked so that the difference is visible.

  Background:
    Given the displayed card is at level 1

  Scenario: Existing children are reused
    Given the card already has two children
    When the person presses deepen
    Then no model call is made
    And the first child is shown
    And the header notes which card it came from

  @llm
  Scenario: Children are generated when there are none
    Given the card has no children
    And the network is available
    When the person presses deepen
    Then between one and three cards are created one level deeper
    And each names this card as its parent
    And each has source generated and is not provisional
    And each gets a question file
    And an edge is added to the graph for each
    And the first one is shown

  Scenario: Offline generation falls back and is marked
    Given the card has no children
    And the network is unavailable and a local model is running
    When the person presses deepen
    Then the local model is used
    And each new card is marked provisional
    And the marker is visible in the interface

  Scenario: No model at all is reported plainly
    Given the network is unavailable and no local model is running
    When the person presses deepen
    Then it says nothing can be generated right now
    And the current card stays on screen

  @manual
  Scenario: Generation is visible and cancellable
    When generation is in progress
    Then a loading state explains what is happening
    And a cancel control is available
    And the three main controls are disabled

  Scenario: Cancelling writes nothing
    When the person cancels during generation
    Then the request is aborted
    And no file is written
    And the current card is still shown

  Scenario: Generated cards obey the same word limit
    Given the model returns an overlong body
    When generation runs
    Then it is retried in the same way as ingest
    And a card that fails three times is skipped while the others are kept

  @manual
  Scenario: Going back up
    Given the displayed card is a generated child
    When the person presses the back control
    Then the parent card is shown
    And the child is not marked learned

  Scenario: Next within a set of children
    Given the displayed card is one of two children of the same parent
    When the person presses next
    Then the current child is marked learned
    And the sibling is shown
    And after the last sibling the next card after the parent is shown

  Scenario: There is a floor to how deep it goes
    Given the displayed card is at the deepest allowed level
    When the person presses deepen
    Then it says this is as deep as it goes
    And no model call is made
