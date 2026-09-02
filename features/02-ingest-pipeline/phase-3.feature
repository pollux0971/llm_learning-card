@i4 @ingest-pipeline @phase-3
Feature: Source rules, generation without raw material, and incremental runs
  Raw first, model second. This phase adds the path for categories that have no
  raw material, and makes ingest reliable as raw keeps growing and changing.

  Scenario: A category that requires raw refuses to invent
    Given the category security requires raw and has none
    When ingest runs with a topic for that category
    Then no cards are written
    And it reports that the category requires raw material

  Scenario: A category that allows generation produces from a topic
    Given the category peach does not require raw and has none
    When ingest runs with a topic for that category
    Then between 1 and 5 level zero cards are written
    And each has source llm and no source reference
    And each has a question file

  Scenario: Raw material wins over a topic
    Given the category peach has a raw file
    When ingest runs with a topic for that category
    Then the produced cards have source raw
    And it reports that the topic was ignored

  Scenario: Only new files are processed
    Given two raw files where one has already been ingested
    When ingest runs
    Then only the unprocessed file is handled
    And the existing cards are untouched

  Scenario: Changed raw marks its cards stale without overwriting them
    Given a raw file has already produced three cards
    And that file has since been edited
    When ingest runs
    Then those three cards are marked stale
    And their content is not overwritten
    And it reports how many cards have a changed source

  Scenario: Deleting raw does not delete cards
    Given a raw file has already produced cards
    And that file has been deleted
    When ingest runs
    Then the cards still exist
    And they are marked as having a missing source

  Scenario: An unknown category is rejected
    When ingest runs for a category that is not configured
    Then it reports that the category is not defined
    And no directory is created

  Scenario: A stale card can still be reviewed
    Given a card is marked stale
    When the scheduler builds today's list
    Then that card is included as normal
