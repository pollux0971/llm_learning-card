@wave0 @teach-card @phase-1 @standalone
Feature: Rendering a card and moving to the next one
  The teach card in its simplest form: show one card, press next, show the next.
  Running in a browser against fixtures, so the rendering — which is the hard
  part — can be got right before anything else exists.

  The example fence plugin lives here and is shared with the test card, so it
  is the one piece of this folder that needs real tests.

  Background:
    Given the development server is running against the rich fixture set

  Scenario: The interface runs on its own
    When the standalone dev command is run
    Then the server starts
    And opening it shows the first card of the first category

  @manual
  Scenario: The card markers are visible
    When a card is displayed
    Then the category name is shown
    And the source is shown as either raw or generated
    And the level is shown
    And a provisional card is marked as awaiting review

  @manual
  Scenario: The body renders as markdown
    Given a card whose body contains bold text and a list
    When it is displayed
    Then the bold text and the list render normally

  Scenario: An example fence renders as nested markdown
    Given a card whose example fence contains a list, bold text and a code block
    When it is rendered
    Then the list and bold text are rendered as markdown
    And the code block inside it is still rendered as code
    And the fence itself is not rendered as preformatted text

  Scenario: A card with no example fence renders cleanly
    Given a card with a body and no example fence
    When it is rendered
    Then no empty example area is shown

  Scenario: Several example fences each get their own block
    Given a card with three example fences
    When it is rendered
    Then three separate example blocks appear

  Scenario Outline: The fence plugin only claims the example language
    Given a fenced block with the language <lang>
    When it is rendered
    Then it is rendered as <result>

    Examples:
      | lang     | result           |
      | example  | nested markdown  |
      | ts       | code             |
      | (none)   | code             |
      | examples | code             |

  Scenario: Pressing next records the card as learned
    When the person presses next
    Then the learned transition is applied for the displayed card
    And the following unlearned card is shown

  @manual
  Scenario: Reaching the end of a category
    Given every card in the category has been marked learned
    When the interface loads
    Then it says the category has been finished
    And it suggests adding more material
    And the next control is disabled

  Scenario: Opening a card does not mark it learned
    When a card is displayed and the interface is closed without pressing anything
    Then that card has no learned record
