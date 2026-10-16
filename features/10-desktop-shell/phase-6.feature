@desktop-shell @phase-6
Feature: Frameless windows
  The person asked for windows without the system frame, so the HUD frame from
  folder 14 is the only frame. When the desktop can draw transparency, the
  windows are transparent so the cut corners show the desktop behind them. When
  it cannot, the windows open opaque in the solid fallback colour and the page
  uses the solid background, so nothing is ever black. The title bar and resize
  handles are drawn by the HUD kit; this phase turns off the system frame, grants
  the window permissions those controls need, and tells the page which mode it
  is in.

  Scenario: Both windows are configured without the system frame
    When the window configuration is read
    Then both windows have the system decorations turned off
    And the configuration leaves transparency to the app

  Scenario: The window permissions cover what the drawn controls need
    When the desktop capability file is read
    Then it allows starting a drag, starting a resize, minimizing and closing
    And it grants no other window operation beyond the defaults

  Scenario: The page is told it has no system frame
    When a window opens
    Then the page root has the frameless class

  Scenario Outline: The solid fallback follows what the desktop can draw
    Given a desktop that <can> draw transparency
    When a window opens
    Then the page root <has> the solid class
    And the window <is> transparent
    And the window background is <background>

    Examples:
      | can    | has           | is     | background                |
      | can    | does not have | is     | left clear                |
      | cannot | has           | is not | the solid fallback colour |

  Scenario Outline: The test card is shown after the teach card, so it gets the keyboard focus
    Given the card windows are opening
    When the <first> window is ready first and the other one after it
    Then the teach card is shown before the test card
    And the keyboard focus is given to the test card right after it is shown

    Examples:
      | first |
      | teach |
      | test  |

  Scenario: The test card does not wait forever for the teach card
    Given the card windows are opening
    And the teach card has not been shown
    When the backstop time has passed
    Then the test card is shown anyway
    And a warning says the test card was shown before the teach card

  Scenario: A single card window does not wait for the other one
    Given only the test card window is opening
    When it is ready
    Then it is shown at once and gets the keyboard focus

  @manual
  Scenario: Dragging and resizing without the system frame
    Given the desktop app is built and started
    When the drawn title bar is dragged
    Then the window moves
    And dragging an edge or a corner resizes it
    And the position and size are back after a restart

  @manual
  Scenario: The drawn buttons behave like the system ones did
    Given the desktop app is built and started
    When the drawn minimize button is pressed
    Then the window minimizes
    And pressing the drawn close button closes the window exactly as the system close button did before this phase

  @manual
  Scenario: The cut corners show the desktop
    Given a desktop that draws transparency
    When the desktop app is built and started
    Then the desktop is visible through the cut corners
    And a click inside a corner still goes to the window, which is the known limit

  @manual
  Scenario: Without transparency the corners are solid, not black
    Given a desktop session without compositing
    When the desktop app is built and started
    Then the corners are filled with the solid fallback colour
    And no black area appears, not even in the first frame after the window is shown

  @manual
  Scenario: The test card has the keyboard focus after every start
    When the desktop app is built and started ten times
    Then each time the teach card appears first and the test card has the keyboard focus

  @manual
  Scenario: Staying on top still works without the frame
    When the desktop app is built and started
    Then both windows still sit above other applications
