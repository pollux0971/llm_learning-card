@desktop-shell @phase-6
Feature: Frameless windows
  The person asked for windows without the system frame, so the HUD frame from
  folder 14 is the only frame. The windows are also transparent so the cut corners
  show the desktop behind them. When the desktop cannot draw transparency, the
  page falls back to a solid background instead of black corners. The title bar
  and resize handles are drawn by the HUD kit; this phase turns off the system
  frame, grants the window permissions those controls need, and tells the page
  which mode it is in.

  Scenario: Both windows are configured without the system frame
    When the window configuration is read
    Then both windows have the system decorations turned off
    And both windows are transparent

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

    Examples:
      | can    | has           |
      | can    | does not have |
      | cannot | has           |

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
    And no black area appears

  @manual
  Scenario: Staying on top still works without the frame
    When the desktop app is built and started
    Then both windows still sit above other applications
