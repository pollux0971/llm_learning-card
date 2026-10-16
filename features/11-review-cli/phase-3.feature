@review-cli @phase-3
Feature: A card that failed twice is never a dead end
  A card that failed twice in a row is shown in a shortened form before it is
  asked again. Nothing in the pipeline produces that short version yet, so the
  review must not stop when it is missing: it falls back to the original card and
  says so, and leaves one warning behind for whoever maintains the data.

  Scenario: A card failed twice in a row has no short version
    Given a card that failed twice in a row is due today
    And that card has no short version
    When the person works through the day's review
    Then the review does not stop early
    And the original card is shown with a note that there is no short version
    And the question of that card is asked afterwards
    And the review ends with exit status 0
    And one warning about the missing short version is logged

  Scenario: A card failed twice in a row has a short version
    Given a card that failed twice in a row is due today
    And that card has a short version
    When the person works through the day's review
    Then the short version is shown without any note
    And the question of that card is asked afterwards
    And no warning about a short version is logged
