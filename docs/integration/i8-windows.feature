@integration @i8
Feature: The same system on Windows

  @e2e @manual
  Scenario: A person installs and completes a session on Windows
    When the person runs the installer and starts the application
    Then both windows appear
    And a notification area icon shows the number due
    When the person completes a review session
    Then the schedule advances and the state file is written

  @manual
  Scenario: Build output
    When the build command runs on Windows
    Then an installer is produced
    And it installs to the user directory without administrator rights

  @manual
  Scenario: Always on top
    When the application starts
    Then both windows sit above other applications
    And full screen games are not forced behind them

  Scenario: Autostart uses the registry run key
    When the person enables start at login
    Then an entry is written under the current user run key

  Scenario: Configuration path
    When the application reads its configuration
    Then the path is under the roaming application data directory

  Scenario: Path separators are handled at the boundary
    Given the front end requests "cards/security/sec-0042.md"
    When the Rust layer resolves it
    Then it converts the separators for the platform
    And the front end never sees a backslash

  @manual
  Scenario: High DPI
    Given the display scaling is 150 percent
    When the application starts
    Then text is sharp and both windows are scaled correctly

  @regression
  Scenario: All prior capabilities work on Windows as in I7
    When the integration suites for I1 through I6 are run on Windows
    Then every non platform specific scenario passes
