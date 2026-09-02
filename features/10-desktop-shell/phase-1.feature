@wave0 @desktop-shell @phase-1 @standalone
Feature: Two windows that stay where you put them
  The shell only. Two small windows with placeholder content, no business logic,
  no file access. Getting window behaviour right on Linux is fiddly enough to
  deserve its own phase.

  @manual
  Scenario: The shell runs on its own
    When the standalone development command is run
    Then two windows appear with placeholder content
    And neither loads anything from a learning directory

  @manual
  Scenario: Two windows with sensible defaults
    When the application starts for the first time
    Then the windows are titled for teaching and testing
    And each is 360 by 480
    And they are positioned so that neither covers the other

  @manual
  Scenario: The windows are independent
    When one window is moved and resized
    Then the other does not move
    And they may overlap if the person wants

  @manual
  Scenario: Position and size survive a restart
    When both windows are moved and resized and the application is closed
    Then the window state is persisted
    And starting again restores both to the same place and size

  @manual
  Scenario: Staying on top under X11
    Given the desktop session is X11
    When the application starts
    Then both windows sit above other windows
    And they remain above after another window is clicked

  @manual
  Scenario: Wayland is detected and explained
    Given the desktop session is Wayland
    When the application starts for the first time
    Then it does not attempt to force itself on top
    And it shows a one time note about configuring this in the desktop environment
    And the note can be dismissed permanently

  Scenario Outline: Detecting the session type
    Given the session type variable is <session> and the display variable is <display>
    When the session is detected
    Then it is treated as <result>

    Examples:
      | session | display  | result  |
      | wayland | wayland-0| wayland |
      | x11     |          | x11     |
      |         | wayland-0| wayland |
      |         |          | x11     |

  @manual
  Scenario: One process serves both windows
    When the process list is inspected
    Then there is a single application process
    And its memory use is modest

  @manual
  Scenario: Closing one window leaves the other
    When one window is closed
    Then the other remains
    And the application does not exit
