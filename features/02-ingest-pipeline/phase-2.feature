@i1 @ingest-pipeline @phase-2
Feature: Questions, second level cards and the dependency graph
  Cards exist; now make them reviewable, deepenable and orderable. All three are
  produced at ingest time so that the next day's review and the first level of
  deepening both work offline.

  Background:
    Given a learning directory containing five level zero cards
    And the real router configured for the cloud

  Scenario: Every level zero card gets a question file
    When question generation runs
    Then every card has a question file with the same id
    And every question file passes the validator

  Scenario: Fill questions come in pairs or triples
    When question generation runs
    Then each question file has between 2 and 3 fill questions
    And each blank has at least one accepted synonym where one exists

  Scenario: Rubric criteria can each be answered yes or no
    When question generation runs
    Then each question file has 1 or 2 apply questions
    And each rubric line is a single checkable statement
    And each rubric has between 2 and 4 lines

  Scenario: Each card gets between one and three children
    When child generation runs
    Then each level zero card has between 1 and 3 level one children
    And each child names its parent
    And each child has source llm
    And each child has its own question file

  Scenario: Prerequisites are inferred for the category
    When dependency analysis runs
    Then the graph contains every card in the category
    And each card's prereqs field agrees with the edges
    And every level one card lists its parent as a prerequisite

  Scenario: A cycle returned by the model is challenged once, then repaired locally
    Given the model returns edges containing a cycle on the first attempt
    When dependency analysis runs
    Then the model is called again with the cycle described
    And if the second attempt still cycles, edges are dropped one at a time until the graph is acyclic
    And each dropped edge is logged as a cycle removed event
    And the graph file and the order file are written together or not at all

  Scenario: Two independent cycles in the retry response are both repaired
    Given the model returns edges containing a cycle on the first attempt
    And the second attempt still returns two independent cycles that share no card or edge
    When dependency analysis runs
    Then both offending edges are dropped
    And the order file exists and lists each card exactly once

  Scenario: Repeated cycles exhaust the local drop limit
    Given the model returns edges containing a cycle on the first attempt
    And the second attempt keeps forming a new cycle after each edge is dropped, up to the card count limit
    When dependency analysis runs
    Then the graph file and the order file are not written
    And a warning naming the remaining cycle is logged

  Scenario: The order file is produced
    When dependency analysis runs
    Then an order file exists for the category
    And the order satisfies the graph

  Scenario: Only the affected category is re-sorted
    Given an order file already exists for another category
    When new cards are ingested for security
    Then only the security order file is rewritten

  Scenario: Generation failure for one card does not lose the others
    Given question generation fails for the third card
    When the run completes
    Then the other four question files exist
    And the failure is reported with the card id

  @manual
  Scenario: Blanks fall on the words that matter
    When any three question files are opened
    Then each blank removes a key noun or number
    And no blank removes a function word
