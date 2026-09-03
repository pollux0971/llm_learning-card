@i2 @scheduler @phase-2
Feature: Failure, repetition and getting stuck
  Answering wrong is not a punishment, it is a signal that this has not entered
  long term memory. Back to the start. Twice in a row and the explanation itself
  is probably the problem.

  Scenario: Failing returns the card to the first checkpoint
    Given a card at stage 3
    And today is 2026-09-10
    When the fail transition is applied
    Then its stage becomes 1
    And it is due on 2026-09-11
    And its consecutive failure count is 1
    And its total failure count is 1

  Scenario: Passing clears the streak but keeps the total
    Given a card with two consecutive failures and two total
    When the pass transition is applied
    Then the consecutive count is zero
    And the total is still two

  Scenario: A second consecutive failure queues a reteach
    Given a card with one consecutive failure
    When the fail transition is applied
    Then the consecutive count is two
    And a reteach event is emitted for that card

  Scenario: A first failure emits nothing
    Given a card with no consecutive failures
    When the fail transition is applied
    Then no events are emitted

  Scenario: A third consecutive failure marks the card stuck
    Given a card with two consecutive failures
    When the fail transition is applied
    Then the card is marked stuck
    And a stuck event is emitted

  Scenario: A stuck card still comes up for review
    Given a stuck card at stage 1 due today
    When the due list is built
    Then it is included
    And the entry is flagged as stuck

  Scenario: Passing clears stuck
    Given a stuck card
    When the pass transition is applied
    Then it is no longer stuck

  Scenario: At stage two either question failing fails the card
    Given a card at stage 2
    When the fill answer passes but the apply answer fails
    Then the caller applies one fail transition
    And the history records both answers separately

  Scenario: Failing appends to the history
    Given a card at stage 2
    When it fails an apply question graded by the cloud
    Then a history entry records the failure with that grader

  Scenario Outline: Repeated failure and recovery
    Given a card with <before> consecutive failures and stuck <stuck_before>
    When the <transition> transition is applied
    Then the resulting consecutive count is <after>
    And the outcomes stuck flag is <stuck_after>

    Examples:
      | before | stuck_before | transition | after | stuck_after |
      | 0      | false        | fail       | 1     | false       |
      | 1      | false        | fail       | 2     | false       |
      | 2      | false        | fail       | 3     | true        |
      | 3      | true         | fail       | 4     | true        |
      | 3      | true         | pass       | 0     | false       |
