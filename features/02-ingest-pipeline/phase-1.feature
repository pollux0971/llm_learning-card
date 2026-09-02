@wave0 @ingest-pipeline @phase-1 @standalone
Feature: Turning raw material into level zero cards
  The first time the pipeline produces real cards. In Wave 0 it runs against a
  fake LLM that replays recorded fixtures, so it is fully offline and
  deterministic and depends on no other module.

  What matters here is structure, not content quality: the word limit is always
  respected, the source is always traceable, and nothing is produced twice.

  Background:
    Given a fake router replaying the recorded fixtures
    And an output directory that has been initialised
    And a category security configured with require_raw true
    And a raw file of about 2000 words under that category

  Scenario: The pipeline runs on its own
    When the standalone ingest command is run with the fake flag
    Then it exits with status 0
    And it prints the list of cards it created
    And no network request is made

  Scenario: One raw file produces several cards
    When ingest runs for that file
    Then at least 3 cards are written under the category directory
    And every card is at level 0
    And every card belongs to that category

  Scenario: Every card records where it came from
    When ingest runs for that file
    Then every card has source raw
    And every source reference names the file and a line range
    And every line range falls inside the file

  Scenario: A body over the limit is regenerated
    Given the fake router returns 130 words on the first attempt
    And 95 words on the second
    When ingest runs
    Then the written card has a 95 word body
    And one regenerate event is logged

  Scenario: Three overlong attempts park the card instead of writing it
    Given the fake router returns an overlong body three times
    When ingest runs
    Then that card is not written
    And it is recorded in the needs review file with all three attempts
    And the other cards are still produced

  Scenario: Running twice produces nothing new
    Given ingest has already run for that file
    When it runs again
    Then the number of cards is unchanged
    And it reports that the file was already processed

  Scenario: Ids continue from the highest existing number
    Given the category already contains cards numbered up to sec-0005
    When ingest produces three new cards
    Then they are numbered sec-0006, sec-0007 and sec-0008

  Scenario: An ingested event is logged
    When ingest runs
    Then the log contains an ingested event
    And it records the file, the number of cards created and the duration

  Scenario: Ingest refuses to degrade to a local model
    Given the router reports that the cloud is required and unavailable
    When ingest runs
    Then no cards are written
    And it reports that ingest needs a cloud model
    And it does not fall back to a local model

  Scenario: An empty raw file is rejected cleanly
    Given a raw file containing only whitespace
    When ingest runs
    Then no cards are written
    And it reports that the file has no usable content
    And it exits with a non zero status

  @manual
  Scenario: The cards read like one concept each
    When a real article is ingested with a real model
    Then opening any three cards shows one idea per card
    And the example section gives a concrete case rather than restating the body
