@i7 @desktop-shell @phase-4
Feature: The macOS shell
  Same code, different platform conventions.

  @manual
  Scenario: Build output
    When the build runs on macOS
    Then an application bundle and a disk image are produced
    And an unsigned build can be opened by right clicking

  @manual
  Scenario: Staying on top
    When the application starts
    Then both windows sit above other applications
    And switching to a full screen application is not overridden

  @manual
  Scenario: The menu bar item
    When the application starts
    Then a menu bar item shows the number due
    And its menu offers the same actions as on Linux

  Scenario: Autostart uses login items
    When autostart is enabled
    Then the application is registered as a login item

  Scenario: The configuration lives in the platform location
    When the configuration is read
    Then the path is under the user's application support directory

  @manual
  Scenario: Closing follows platform convention
    When the close button is clicked
    Then the window hides and the process stays in the menu bar
    And the quit shortcut ends the process

  Scenario: Paths with spaces and non ASCII characters resolve
    Given a learning directory whose path contains a space and a non ASCII character
    When a card is read
    Then the file is found

  Scenario: The path guards behave identically
    When the escape attempts from phase 2 are repeated on macOS
    Then every one of them is refused
