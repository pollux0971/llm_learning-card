@i1 @data-layer @phase-3
Feature: Dependency graph, cycle detection and topological order
  Teaching order follows prerequisites. This phase owns the shape of the graph
  and the ordering algorithm; producing the graph belongs to ingest.

  Background:
    Given the category security contains the cards sec-0001 through sec-0004

  Scenario: The graph is grouped by category
    Given the graph file contains both security and language
    When the security graph is read
    Then only the nodes and edges for security are returned

  Scenario: Both ends of an edge must exist
    Given an edge from sec-0001 to a card that does not exist
    When the validator runs
    Then the result is a failure
    And the error names the missing card

  Scenario: Cycles are detected and reported as a path
    Given edges from sec-0001 to sec-0002, sec-0002 to sec-0003 and sec-0003 to sec-0001
    When cycle detection runs
    Then the cycle is reported as a path through all three cards

  Scenario: A self edge is a cycle
    Given an edge from sec-0001 to itself
    When cycle detection runs
    Then a cycle is reported

  Scenario: Topological order puts prerequisites first
    Given edges from sec-0001 to sec-0003, sec-0002 to sec-0003 and sec-0003 to sec-0004
    When the topological sort runs
    Then sec-0003 comes after both sec-0001 and sec-0002
    And sec-0004 comes after sec-0003

  Scenario: Cards with no ordering between them fall back to source order
    Given sec-0001 and sec-0002 have no edge between them
    And sec-0002 appears earlier in the raw material
    When the topological sort runs
    Then sec-0002 comes before sec-0001

  Scenario: With no edges the order is the source order
    Given the category has no edges
    When the topological sort runs
    Then the order matches the order the cards appear in the raw material

  Scenario: A card's prereqs field must agree with the graph
    Given sec-0003 lists sec-0001 as a prerequisite
    But the graph only has an edge from sec-0002 to sec-0003
    When the consistency check runs
    Then the disagreement is reported for sec-0003

  Scenario: The order is written per category
    When the topological sort for security is saved
    Then a file named for that category exists under the graph directory
    And it contains an ordered array of card ids
    And every card in the category appears exactly once

  Scenario: Sorting one category leaves others alone
    Given an order file already exists for language
    When the security order is regenerated
    Then the language order file is unchanged
