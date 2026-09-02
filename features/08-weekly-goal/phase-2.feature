@i5 @weekly-goal @phase-2
Feature: Showing the weekly count
  Small, at the top, in both cards. No popups and no celebration.

  @manual
  Scenario: The count appears in the teach card
    Given three of a target of seven have passed
    When the teach card is opened
    Then the header shows three of seven

  @manual
  Scenario: Reaching the target is marked quietly
    Given the count equals the target
    When the teach card is opened
    Then a small check appears beside the count
    And there is no popup, animation or sound

  @manual
  Scenario: Going past the target keeps counting
    Given nine of a target of seven have passed
    When the teach card is opened
    Then the header shows nine of seven

  @manual
  Scenario: Cards awaiting their first review are noted
    Given five cards were learned and three have passed their first checkpoint
    When the teach card is opened
    Then the header notes that two are still awaiting review

  Scenario: The target can be changed and takes effect at once
    When the weekly target is changed in settings
    Then the settings file is updated
    And the weekly state target is updated
    And both cards show the new target

  Scenario Outline: An invalid target is refused
    When the weekly target is set to <value>
    Then it is refused with a message about positive whole numbers

    Examples:
      | value |
      | 0     |
      | -3    |
      | 1.5   |

  @manual
  Scenario: The count also appears in the test card summary
    When a review session finishes
    Then the summary includes the weekly count
