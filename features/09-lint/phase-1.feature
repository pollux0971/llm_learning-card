@wave0 @lint @phase-1 @standalone
Feature: Health checks over a learning directory
  The data is plain files, so anything can break it. Lint is the periodic
  check-up: it reports and it does not touch anything.

  In Wave 0 it carries its own minimal validator rather than depending on the
  data layer. That duplication is deliberate — two independent readings of the
  same contract will expose any ambiguity in it.

  Background:
    Given the deliberately broken fixture directory

  Scenario: Lint runs on its own
    When the standalone lint command is run against the broken fixture
    Then it exits with status 1
    And it prints one line per problem

  Scenario: A clean directory passes
    When lint is run against the minimal fixture
    Then it reports no problems
    And it exits with status 0

  Scenario: An overlong body is found
    Given a card whose body was edited past the limit
    When lint runs
    Then the card and its actual word count are reported

  Scenario: A missing question file is found
    Given a card whose question file was deleted
    When lint runs
    Then that card is reported as missing its questions

  Scenario: An orphaned question file is found
    Given a question file whose card does not exist
    When lint runs
    Then that question file is reported as orphaned

  Scenario: A prerequisite pointing nowhere is found
    Given a card listing a prerequisite that does not exist
    When lint runs
    Then that card and the missing prerequisite are reported

  Scenario: An orphaned child card is found
    Given a card whose parent does not exist
    When lint runs
    Then that card and the missing parent are reported

  Scenario: A cycle is found and shown as a path
    Given the graph contains a cycle
    When lint runs
    Then the cycle is reported as a path

  Scenario: A disagreement between prereqs and the graph is found
    Given a card whose prereqs do not match the graph edges
    When lint runs
    Then each disagreement is reported

  Scenario: Stale and orphaned sources are listed separately
    Given two cards marked stale and one marked as having a missing source
    When lint runs
    Then the two groups are reported separately

  Scenario: A review entry for a deleted card is found
    Given the review state names a card that no longer exists
    When lint runs
    Then that entry is reported

  Scenario: A report is written
    When lint runs
    Then a dated report file is written under the state directory
    And each problem occupies one line with a type, a card id and a path
    And the report opens with a count of problems
    And the same content is printed to the terminal

  Scenario: Lint changes nothing
    When lint runs with no options
    Then the cards, questions, graph and review state are byte identical to before

  Scenario: Every problem in the broken fixture is found
    When lint runs against the broken fixture
    Then the number of reported problems equals the number the fixture documents
