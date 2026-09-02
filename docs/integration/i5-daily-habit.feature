@integration @i5
Feature: The system becomes part of the day
  It starts with the machine, sits in the tray, counts toward a weekly target,
  and reteaches what keeps being forgotten. Nothing here is new capability —
  it is the difference between a tool you have and a tool you use.

  Background:
    Given the desktop application is installed on Linux
    And a learning directory in daily use

  @e2e @manual
  Scenario: A person uses the system for a week without thinking about it
    Given autostart is enabled
    When the machine is restarted
    Then the tray icon appears without any window opening
    And the icon shows the number of cards due today
    When the person opens the test card from the tray and completes the session
    Then the weekly counter increases for each card that passed its D1 review
    And no window needs to be launched manually for the rest of the week

  Scenario: Only cards that pass D1 count toward the weekly target
    Given the weekly target is 7 and the count is 0
    When the person learns 5 cards in the teach card
    Then the weekly count remains 0
    When the person passes 3 of them at D1 the next day
    Then the weekly count is 3

  Scenario: A card counts at most once per week
    Given a card has already passed D1 this week
    When it fails later and passes D1 again in the same week
    Then the weekly count does not increase again

  Scenario: The week rolls over without penalty
    Given the current week reached 3 of a target of 7
    When the ISO week changes
    Then a week_rolled event is logged with met false
    And the counters reset to 0
    And the target is preserved
    And no other state changes

  @manual
  Scenario: Reaching the target is marked quietly
    Given the weekly count equals the target
    When the person opens the teach card
    Then a small check appears next to the counter
    And there is no popup, animation or sound

  @manual
  Scenario: A card failed twice is retaught before the session
    Given a card has failed twice in a row
    When the person opens the test card
    Then a review block appears before the first question
    And it shows a shortened version of at most 50 words
    And it is labelled as an alternative explanation
    When the person acknowledges it
    Then it is removed from the reteach queue
    And it does not count toward today's question total

  @manual
  Scenario: Closing a window hides it rather than quitting
    When the person closes the test card window
    Then the process keeps running
    And the window can be reopened from the tray

  @manual
  Scenario: Pausing today does not record failures
    When the person selects pause today from the tray
    Then the test card shows that today is paused
    And no card is recorded as failed
    And tomorrow those cards are one day more overdue

  @manual
  Scenario: GNOME without AppIndicator degrades rather than breaks
    Given the desktop is GNOME with no AppIndicator extension
    When the application starts
    Then it runs normally
    And it shows a one time note about installing the extension

  @regression @i4
  Scenario: Both cards still work
    When the person learns a card and reviews it the next day
    Then the full flow works as in I4

  Scenario: Every standalone entry point still runs
    When every non interactive command in the standalone manifest is executed
    Then each exits with status 0
    And each output contains the expected marker
