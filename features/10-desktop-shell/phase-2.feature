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

  # Path check (decision of 2026-10-01, contract section 13, version 1.3.0):
  # the LearningFs boundary does no conversion of any kind. The input must already be the
  # one clean form, otherwise it is refused. The string that is checked and the string that
  # is used are the same string, byte for byte. The check is a whitelist (single "/" between
  # non-empty segments, every character in the allowed set, no segment starting with "."),
  # so traversal, absolute paths, drive letters, "~", backslashes, percent signs, leading
  # whitespace, NUL and redundant spellings ("./", "//") are refused without a rule each.
  # "cards/../state/reviews.json" is refused on purpose: nothing here needs to walk back.
  # The asset protocol handler is the only place that decodes (exactly once, as the protocol
  # defines); it then hands the result to the same check.
  #
  # Encoding of the <path> column: every path is a JSON string, quotes included, and the
  # step definition decodes it with JSON.parse. Reason: a Gherkin table cell trims
  # surrounding whitespace and treats a backslash as an escape, so a raw cell cannot carry
  # " ../x" or a Windows path. Inside a cell one real backslash is written as four
  # backslashes (Gherkin turns each pair into one, JSON.parse turns the remaining pair
  # into one). The expected decoded value of every row is in
  # features/10-desktop-shell/PATH-GUARD-EVIDENCE.md.

  Scenario Outline: Paths that escape the learning directory through the read command are refused
    When the front end requests the JSON-encoded path <path> through the read command
    Then the request is refused
    And the refusal is returned to the TypeScript caller
    And the TypeScript caller records a warning event through recordEvent
    And no file outside the learning directory is read

    Examples:
      | path                           |
      | "../../etc/passwd"             |
      | "cards/../../../etc/passwd"    |
      | "/etc/passwd"                  |
      | "cards/./../../secret"         |
      | "//etc/passwd"                 |
      | ".."                           |
      | "..%2f..%2fetc%2fpasswd"       |
      | "..%2F..%2Fetc%2Fpasswd"       |
      | "%2e%2e/%2e%2e/etc/passwd"     |
      | "..%252f..%252fetc"            |
      | "..\\\\..\\\\etc\\\\passwd"    |
      | "cards\\\\..\\\\..\\\\secret"  |
      | "\\\\etc\\\\passwd"            |
      | "\\\\\\\\server\\\\share\\\\x" |
      | "C:\\\\Windows\\\\win.ini"     |
      | "C:/Windows/win.ini"           |
      | "file:///etc/passwd"           |
      | "~/secret"                     |
      | " ../x"                        |
      | "cards/../state/reviews.json"  |
      | "./cards/a.md"                 |
      | "cards//a.md"                  |
      | "cards/.hidden.md"             |

  Scenario: A path containing a NUL character is refused
    When the front end requests the path "cards/a.md", then a NUL character, then ".png" through the read command
    Then the request is refused
    And the refusal is returned to the TypeScript caller
    And the TypeScript caller records a warning event through recordEvent

  Scenario: The checked path is the used path
    When the front end requests the JSON-encoded path "..\\..\\etc\\passwd" through the read command
    Then the request is refused
    And the string that was checked is byte-identical to the string that would have been used

  # Known limitation: a refusal on the asset protocol path has no TypeScript caller
  # to return to, so it is written to the Rust log only. It does not produce a
  # contract section 10 warning event. Reimplementing the section 11b four-step
  # write in Rust was rejected because nothing would check that it stayed identical.
  Scenario Outline: Paths that escape through the asset protocol are refused without going through the read command
    When the web view requests the asset url for the JSON-encoded path <path> directly
    Then the request is refused
    And the refusal is written to the Rust log only
    And no warning event is written to the learning log

    Examples:
      | path                          |
      | "../../etc/passwd"            |
      | "/etc/passwd"                 |
      | "..%2f..%2fetc%2fpasswd"      |
      | "..\\\\..\\\\etc\\\\passwd"   |
      | "cards/../state/reviews.json" |
      | "..%252f..%252fetc"           |

  Scenario: The asset protocol is scoped to the learning directory
    Given the application configuration
    Then the asset protocol is enabled with a scope limited to the learning directory
    And the asset protocol applies the same path checks as the read command

  Scenario Outline: Legitimate paths are allowed
    When the front end requests the path <path>
    Then the request succeeds

    Examples:
      | path                          |
      | cards/security/sec-0042.md    |
      | state/reviews.json            |
      | assets/sec-0042-diagram.png   |
      | assets/sec_0042_diagram.png   |

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
