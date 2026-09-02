@i3 @desktop-shell @phase-2
Feature: The file boundary and the learning directory
  The front end never touches the file system directly. Everything goes through
  a narrow interface that refuses anything outside the learning directory.

  This is a security boundary, so unlike the rest of this folder it is tested
  automatically and thoroughly.

  Scenario: First run asks where the learning directory is
    Given no configuration file exists
    When the application starts
    Then it asks the person to choose a learning directory
    And it offers to initialise the directory if it is empty
    And the chosen path is saved to the configuration

  Scenario: A configured path that no longer exists is reported
    Given the configured path does not exist
    When the application starts
    Then it says the directory could not be found
    And it asks the person to choose again

  Scenario: Reading a file goes through the boundary
    When the front end requests a card file
    Then the read command is invoked with a path relative to the learning directory

  Scenario Outline: Paths that escape the learning directory are refused
    When the front end requests the path <path>
    Then the request is refused
    And a warning is logged

    Examples:
      | path                        |
      | ../../etc/passwd            |
      | cards/../../../etc/passwd   |
      | /etc/passwd                 |
      | cards/./../../secret        |
      | ..%2f..%2fetc%2fpasswd      |

  Scenario Outline: Legitimate paths are allowed
    When the front end requests the path <path>
    Then the request succeeds

    Examples:
      | path                          |
      | cards/security/sec-0042.md    |
      | state/reviews.json            |
      | assets/sec-0042-diagram.png   |

  Scenario: A symbolic link out of the directory is refused
    Given a symbolic link inside the learning directory points outside it
    When the front end requests that path
    Then the request is refused

  Scenario: The plugin scope also refuses
    When the front end attempts a direct file read outside the scope
    Then the plugin refuses it independently of the command check

  Scenario: Asset URLs are produced for images
    When an asset url is requested for an image inside the assets directory
    Then a url the web view can load is returned
    And the same path checks apply

  Scenario: The real front ends are loaded
    When the application starts
    Then the teach card and test card front ends are loaded
    And no placeholder content remains
