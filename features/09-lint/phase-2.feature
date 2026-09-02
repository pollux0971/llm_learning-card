@i6 @lint @phase-2
Feature: Reconciliation, stuck cards and regeneration
  The only place lint touches anything, and only when explicitly asked.

  Scenario: Everything provisional is listed
    Given three provisional cards and two provisional grading results exist
    When lint runs
    Then a section lists all five

  Scenario: Reconciliation replays each provisional result against the cloud
    Given the network is available and five items are queued
    When lint runs with the reconcile option
    Then each is replayed against the cloud
    And each is resolved
    And the report says for each whether the outcome changed

  Scenario: Reconciliation offline refuses
    Given the network is unavailable
    When lint runs with the reconcile option
    Then it reports that reconciliation needs the cloud
    And the queue is unchanged

  Scenario: A regenerated card keeps the old version
    Given a provisional card whose cloud regeneration differs
    When it is resolved
    Then the local version is kept with a backup suffix
    And the new version replaces the original and is no longer provisional

  Scenario: Stuck cards are listed with their history
    Given two cards are stuck
    When lint runs
    Then a section lists them
    And each shows its recent history and total failures

  Scenario: Regenerating a card preserves its identity
    Given the network is available
    When a named card is regenerated
    Then the body and examples are rewritten from its original source
    And the id, category, level, parent, prereqs and creation date are unchanged
    And its review history is preserved
    And the consecutive failure count is reset and stuck is cleared
    And the previous version is kept as a backup
    And its question file is regenerated

  Scenario: Regenerating something that does not exist is reported
    When a card id that does not exist is given
    Then it reports that the card was not found

  Scenario: Regenerating a generated card uses its parent
    Given a card with source generated and no source reference
    When it is regenerated
    Then its parent's content and its own title are used as the basis
    And its source stays generated

  Scenario: Several cards can be regenerated at once
    When two card ids are given
    Then both are processed in turn
    And a failure on one does not affect the other

  Scenario: Lint agrees with the data layer validator
    When both validators are run against every card fixture
    Then they reach the same verdict on every one
    And they report the same word count on every one

  @manual
  Scenario: A regenerated card is still the same concept
    When a stuck card is regenerated
    Then the title and the core idea are unchanged
    And the explanation is noticeably different from the previous one
