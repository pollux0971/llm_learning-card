@hud-skin @phase-2
Feature: Both cards wear the HUD
  The teach card and the test card switch to the shared HUD pieces from phase-1.
  Only the look changes: what the buttons do and what the cards show stay the
  same, so every accepted scenario of both cards must keep passing unchanged.

  Scenario: The teach card draws its frame with the HUD kit
    When the teach card source is scanned
    Then its panel, its three buttons and its title bar come from the HUD kit
    And it draws no frame or title bar of its own

  Scenario: The test card draws its frame with the HUD kit
    When the test card source is scanned
    Then its panel, its answer field, its submit button and its progress bar come from the HUD kit
    And it draws no frame or title bar of its own

  Scenario: The test card progress is an HP bar
    Given a session of three questions with one answered
    When the test card is shown
    Then the progress is drawn as an HP bar filled to one third
    And the text 1 / 3 is still shown next to it

  Scenario: The cards keep behaving the same
    When the scenarios of every done phase of the teach card and the test card are run
    Then they all pass
    And none of their feature files was changed

  @manual
  Scenario: The teach window looks like the gallery
    Given the desktop app is built and started
    When the teach window shows a card with an example
    Then the card sits inside a very thin black frame with cut corners
    And the three buttons are HUD buttons
    And the example box keeps a margin on both sides instead of touching the right edge

  @manual
  Scenario: The answer field and the submit button are easy to see
    Given the desktop app is built and started
    When the test window shows a fill question
    Then the answer field is a full HUD input box, not a thin line
    And the submit button is visible without scrolling

  @manual
  Scenario: A full length body is easy to read
    Given the desktop app is built and started
    When the teach window shows a card whose body is one hundred characters long
    Then the whole body is readable at the default window size
