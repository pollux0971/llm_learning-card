@i8 @desktop-shell @phase-5
Feature: The Windows shell

  @manual
  Scenario: Build output
    When the build runs on Windows
    Then an installer is produced
    And it installs to the user directory without administrator rights

  @manual
  Scenario: Staying on top
    When the application starts
    Then both windows sit above other applications
    And full screen games are not forced behind them

  @manual
  Scenario: The notification area item
    When the application starts
    Then a notification area icon shows the number due
    And its menu offers the same actions as on Linux

  Scenario: Autostart uses the run key
    When autostart is enabled
    Then an entry is written under the current user run key

  Scenario: The configuration lives in the platform location
    When the configuration is read
    Then the path is under the roaming application data directory

  Scenario: Separators are converted at the boundary
    Given the front end requests a path with forward slashes
    When the native layer resolves it
    Then it converts the separators for the platform
    And the front end never receives a backslash

  Scenario Outline: Windows specific escape attempts are refused
    When the front end requests the path <path>
    Then the request is refused

    Examples:
      | path                    |
      | ..\..\Windows\System32  |
      | C:\Windows\System32     |
      | \\server\share          |
      | cards\..\..\secret      |

  @manual
  Scenario: High density displays
    Given the display scaling is above one hundred percent
    When the application starts
    Then text is sharp
    And both windows are sized correctly
