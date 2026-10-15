@ingest-pipeline @phase-4
Feature: Second level cards know what the category already covers
  A second level card is generated from one parent card. The model used to see
  only that parent, so two parents on neighbouring topics could each produce a
  child that says the same thing. From now on the prompt also lists the other
  cards of the same category, with a title and one sentence each, and tells the
  model those points already have a card.

  Scenario: The children prompt lists the other cards of the category
    Given a category with four cards, one of them the parent
    When children are generated for the parent
    Then the prompt carries an already-covered block before the parent body
    And the block lists the other three cards, each with its title and the first sentence of its body

  Scenario: A category with nothing else in it has no block
    Given a category whose only card is the parent
    When children are generated for the parent
    Then the prompt carries no already-covered block
    And the prompt is the same as the one built from the parent alone

  Scenario: Only readable cards of the same category are listed
    Given the category also holds a short version file and a card file that cannot be parsed
    And another category holds a card of its own
    When children are generated for the parent
    Then the block lists none of those three
    And the block does not list the parent itself

  Scenario: The block is ordered by id and capped at eighty cards
    Given a category with one hundred cards besides the parent
    When children are generated for the parent
    Then the block lists exactly eighty cards
    And they are the eighty with the highest ids, in ascending id order

  Scenario: The second parent sees the children written for the first
    Given two parents in the same category
    When children are generated for both parents in turn
    Then the prompt for the second parent lists the children written for the first
