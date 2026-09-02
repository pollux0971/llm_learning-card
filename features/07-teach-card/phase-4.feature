@i4 @teach-card @phase-4
Feature: Examples, zoom and images
  Examples do not count toward the word limit, so they can be long. They need to
  fold away, scale up, and show pictures.

  @manual
  Scenario: Examples are expanded by default and can be folded
    When a card with an example is displayed
    Then the example is expanded
    And clicking its heading folds it
    And the folded state persists across cards

  @manual
  Scenario: Several examples fold independently
    Given a card with three examples
    When it is displayed
    Then each block has its own heading
    And each folds independently

  Scenario: Image paths resolve against the assets directory
    Given an example contains a relative image path
    When it is rendered
    Then the image source resolves to the assets directory through the desktop boundary

  @manual
  Scenario: Images can be enlarged
    When the person clicks an image inside an example
    Then it is shown enlarged over the card
    And clicking anywhere or pressing escape closes it

  @manual
  Scenario: A missing image does not break the card
    Given an image file referenced by an example does not exist
    When the card is rendered
    Then a placeholder names the missing file
    And the rest of the card renders normally

  @manual
  Scenario: Text size can be adjusted
    When the person uses the zoom in shortcut
    Then the whole card scales up one step
    And the zoom out and reset shortcuts work
    And the setting persists across cards

  @manual
  Scenario: Long content scrolls without losing the controls
    Given a card with a very long example
    When it is displayed
    Then the body stays fixed at the top
    And the example area scrolls
    And the three controls stay fixed at the bottom

  @manual
  Scenario: The layout adapts to the window size
    When the window is resized
    Then the content reflows
    And it stops shrinking at the minimum width
