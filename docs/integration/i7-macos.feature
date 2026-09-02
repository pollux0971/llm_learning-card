@integration @i7
Feature: The same system on macOS
  One codebase, a different shell. Only platform behaviour changes.

  @e2e @manual
  Scenario: A person installs and completes a session on macOS
    When the person opens the built application
    Then both windows appear
    And a menu bar icon shows the number due
    When the person completes a review session
    Then the schedule advances and the state file is written

  @manual
  Scenario: Build output
    When the build command runs on macOS
    Then a .app bundle and a .dmg are produced
    And the unsigned application can be opened by right clicking

  @manual
  Scenario: Always on top
    When the application starts
    Then both windows sit above other applications
    And full screen application switching is not forced

  Scenario: Autostart uses Login Items
    When the person enables start at login
    Then the application is registered as a Login Item

  Scenario: Configuration path
    When the application reads its configuration
    Then the path is under the user's Application Support directory

  @manual
  Scenario: Closing follows platform convention
    When the person clicks the red close button
    Then the window hides and the process stays in the menu bar
    And the quit shortcut ends the process

  Scenario: Paths with spaces and non ASCII characters resolve
    Given a learning directory whose path contains a space and a Chinese character
    When the application reads a card
    Then the file is found

  @regression @i6
  Scenario: All prior capabilities work on macOS
    When the integration suites for I1 through I6 are run on macOS
    Then every non platform specific scenario passes
