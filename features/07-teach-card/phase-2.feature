@i4 @teach-card @phase-2
Feature: Categories, dependency order and prerequisite hints
  Prerequisites come first, but they never block. The person can always jump
  ahead; they just get told what they are missing.

  Background:
    Given three categories are configured
    And a real learning directory with order files

  @manual
  Scenario: Switching category
    When the person presses the category control
    Then the categories are listed with how many remain in each
    And choosing one shows its first unlearned card

  Scenario: Switching also records the current card as learned
    When the person switches to another category
    Then the card that was displayed is recorded as learned

  Scenario: The last category is remembered
    Given the interface was closed while showing the language category
    When it is opened again
    Then the language category is shown

  Scenario: Order comes from the order file
    Given the order file lists three unlearned cards in a particular sequence
    When the person presses next twice
    Then the cards appear in that sequence

  Scenario: A missing order file falls back to id order
    Given no order file exists for the category
    When the interface loads
    Then cards are shown in id order
    And a warning is logged suggesting the order be rebuilt

  @manual
  Scenario: Unlearned prerequisites are named
    Given the displayed card has two prerequisites and one is unlearned
    When it is displayed
    Then the unlearned prerequisite is named at the top
    And the learned one is not mentioned

  @manual
  Scenario: A prerequisite hint can be followed
    When the person clicks the named prerequisite
    Then that card is shown
    And the card they came from is not marked learned

  Scenario: An unlearned prerequisite does not block
    Given the displayed card has an unlearned prerequisite
    When the person presses next
    Then the card is marked learned as normal

  @manual
  Scenario: Categories that require raw material are marked
    When the category list is shown
    Then categories requiring raw material carry a marker
