@i3 @test-card @phase-3
Feature: Progress, overdue count and the daily summary
  Enough information to know where you are and what tomorrow looks like.
  Not more than that.

  @manual
  Scenario: The header includes the overdue count
    Given five questions are due and two are more than a day late
    When the interface loads
    Then the header shows the progress and that two are overdue

  @manual
  Scenario: The session ends with a summary
    Given five questions were answered with three passes and two returns
    When the last question is completed
    Then the summary shows three passed and two returned
    And it estimates how many are due tomorrow

  Scenario: Tomorrow's estimate accounts for returns and the cap
    Given four cards were already due tomorrow
    And two cards were returned today
    When the estimate is computed
    Then it reports six
    And if that exceeds the cap it reports the cap and how many defer

  @manual
  Scenario: A stuck card is marked
    Given the current card has failed three times in a row
    When it is displayed
    Then a small marker notes the repeated failures

  Scenario: Closing part way through resumes in the same place
    Given five questions were due and two were answered before closing
    When the interface is reopened the same day
    Then it resumes at the third question
    And the header shows two of five

  Scenario: The day's question set is fixed once chosen
    Given the session was built in the morning with ten questions
    And more cards have become due since
    When the interface is reopened later the same day
    Then the same ten questions are used
    And the newly due cards wait until tomorrow

  Scenario: Crossing midnight rebuilds the set
    Given three questions were left unanswered yesterday
    When the interface is opened today
    Then the session is rebuilt
    And yesterday's three are one day more overdue

  @manual
  Scenario: Pausing the day records nothing
    When the person pauses today from the tray
    Then the interface says today is paused
    And no failures are recorded
    And tomorrow those cards are one day more overdue
