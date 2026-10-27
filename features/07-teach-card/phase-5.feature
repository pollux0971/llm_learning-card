@i4 @teach-card @phase-5
Feature: The daily load hint
  Learning has no daily limit, so the teach card says what today has cost
  instead. Its footer shows how many cards were learned today and roughly how
  many are due tomorrow, and the person decides when to stop.

  Learned today is the number of review records whose learned_at is today's
  local date, the same date the card was recorded with. Due tomorrow comes from
  the same function as the estimate in the test card summary, so both cards
  show the same number.

  Scenario: Only cards learned today are counted
    Given 4 cards were learned today and 1 card was learned yesterday
    When the teach card is opened
    Then the footer says 4 were learned today

  Scenario: Pressing next counts the card at once
    Given 4 cards were learned today and 1 card was learned yesterday
    And the teach card is open
    When the person presses next
    Then the footer now says 5 were learned today

  Scenario: Switching category counts the card at once
    Given 4 cards were learned today and 1 card was learned yesterday
    And the teach card is open
    When the person picks another category in the teach card
    Then the footer now says 5 were learned today

  Scenario: The count does not depend on the window staying open
    Given 4 cards were learned today and 1 card was learned yesterday
    And the person pressed next and then closed the teach card
    When the teach card is opened
    Then the footer says 5 were learned today

  Scenario: Learning a card raises tomorrow's estimate
    Given 4 cards were learned today and 1 card was learned yesterday
    And the teach card is open
    When the person presses next
    Then the footer's estimate for tomorrow is one more than before

  Scenario: Tomorrow's estimate is the one the test card shows
    Given some cards are due today and some are due tomorrow
    And today's test card session ended with 2 cards returned
    When the teach card is opened
    Then the footer's estimate for tomorrow equals the estimate in the test card summary

  Scenario: Tomorrow's estimate stops at the daily cap
    Given more cards are due tomorrow than the daily cap in the settings
    When the teach card is opened
    Then the footer's estimate for tomorrow is the daily cap

  Scenario: An empty learning directory shows zeros
    Given the categories are configured but there are no cards and no review state
    When the teach card is opened
    Then the footer says 0 were learned today and 0 are due tomorrow
    And the teach card shows no error

  @manual
  Scenario: The hint is small and stays out of the way
    Given the person has learned 4 cards today
    When a card is displayed and when a category has been finished
    Then the footer shows both numbers on one short line
    And it does not move the controls or the status line
    And it stays readable at the minimum window size and at every zoom step
