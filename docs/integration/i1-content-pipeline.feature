@integration @i1
Feature: Content pipeline turns raw material into a readable card set
  After I1 a person can drop an article into raw/, run one command, and get
  cards, questions and a suggested learning order they can browse in any
  markdown viewer. Nothing is reviewable yet — that is I2.

  This is the first point where the modules stop being stubs to each other:
  ingest now calls the real llm-router, and both ingest and lint use the
  real validators from data-layer.

  Background:
    Given a learning directory initialised at "./learning"
    And the category "security" is configured with require_raw true
    And a cloud LLM provider is configured and reachable

  @e2e @llm
  Scenario: A person turns one article into a browsable card set
    Given the file "raw/security/web-basics.md" contains a 2000 word article
    When the person runs the ingest command for that file
    Then at least 3 cards exist under "cards/security/"
    And every card passes the data-layer validator
    And every card has a question file with the same id
    And "graph/order-security.json" lists every card exactly once
    And the person can open any card in a markdown viewer and read it

  Scenario: The pipeline works without any fake in the loop
    Given the fake router fixtures directory is renamed away
    When the ingest command runs
    Then it still produces cards
    And it fails loudly if the network is unavailable

  Scenario: Ingest and lint agree on the word count
    When both the ingest validator and lint are run against the word count fixture
    Then both report the same count

  Scenario: Every generated card body is within the limit
    When the ingest command runs
    Then no card body exceeds 100 words as counted by the shared counter
    And any example fences are excluded from that count

  Scenario: Second level cards are pregenerated
    When the ingest command runs
    Then each level 0 card has between 1 and 3 level 1 children
    And each child has parent set to its level 0 card
    And each child has its own question file

  Scenario: The dependency graph is acyclic
    When the ingest command runs
    Then cycle detection over "graph/deps.json" reports no cycles
    And every card's prereqs field agrees with the edges in deps.json

  Scenario: Re-running ingest changes nothing
    Given the ingest command has already run for "raw/security/web-basics.md"
    When the person runs it again
    Then the number of cards is unchanged
    And the command reports that the file was already processed

  Scenario: Offline ingest refuses rather than degrading
    Given the network is unavailable
    When the person runs the ingest command
    Then no cards are written
    And the command reports that ingest requires a cloud model

  Scenario: Every standalone entry point still runs
    When every non interactive command in the standalone manifest is executed
    Then each exits with status 0
    And each output contains the expected marker

  @manual
  Scenario: The cards read like one concept each
    When the person opens any three generated cards
    Then each card explains exactly one idea
    And the example section shows a concrete case rather than restating the body
