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

  # Path check (contract section 13, version 1.3.1; decisions of 2026-10-01 and 2026-10-14):
  # the LearningFs boundary does no conversion of any kind. The input must already be the
  # one clean form, otherwise it is refused. The string that is checked and the string that
  # is used are the same string, byte for byte. The check is a whitelist:
  #   - single "/" between non-empty segments, no leading or trailing "/";
  #   - every character is ASCII A-Z a-z 0-9 _ - . or has Unicode general category L, N or M;
  #   - the whole path is already NFC (refused, never converted);
  #   - at most 240 bytes of UTF-8;
  #   - no segment starting or ending with ".";
  #   - no segment whose part before the first "." is a Windows reserved device name
  #     (CON PRN AUX NUL COM1-COM9 COM1-COM3 superscripts LPT1-LPT9 LPT1-LPT3 superscripts;
  #     not COM0, not LPT0; compared with fixed ASCII case folding).
  # So traversal, absolute paths, drive letters, "~", backslashes, percent signs, "+",
  # leading whitespace, NUL and redundant spellings ("./", "//") are refused without a rule each.
  # Upper case is allowed (category names are the person's own raw folder names).
  # "cards/../state/reviews.json" is refused on purpose: nothing here needs to walk back.
  # raw/ is not served: all five LearningFs methods refuse a first segment of raw, compared
  # with fixed ASCII case folding.
  # The asset protocol handler is the only place that decodes (exactly once, as the protocol
  # defines); it then hands the result to the same check, and uses that decoded string.
  #
  # Encoding of the <path> column: every path is a JSON string, quotes included, and the
  # step definition decodes it with JSON.parse. Characters outside ASCII are written as
  # JSON unicode escapes (one backslash plus u plus four hex digits, written with two backslashes
  # in a cell), so a decomposed form such as U+1100 U+1161 can never be silently turned into
  # the composed form U+AC00 by an editor. Reason: a Gherkin table cell trims
  # surrounding whitespace and treats a backslash as an escape, so a raw cell cannot carry
  # " ../x" or a Windows path. Inside a cell one real backslash is written as four
  # backslashes (Gherkin turns each pair into one, JSON.parse turns the remaining pair
  # into one). The expected decoded value of every row is in
  # features/10-desktop-shell/PATH-GUARD-EVIDENCE.md.

  Scenario Outline: Paths that are not clean relative paths are refused through the read command
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
      | "cards/a."                     |
      | "nul.md"                       |
      | "CON"                          |
      | "cards/Aux.txt"                |
      | "com1.md"                      |
      | "cards/"                       |
      | ""                             |
      | "cards/\\u1100\\u1161.md"      |
      | "cards/\\uf900.md"             |
      | "cards/e\\u0301.md"            |
      | "COM\\u00b9.txt"               |
      | "cards/C++.md"                 |
      | "LPT\\u00b2.log"               |
      | "cards/Lpt3.md"                |

  Scenario: A path containing a NUL character is refused
    When the front end requests the path "cards/a.md", then a NUL character, then ".png" through the read command
    Then the request is refused
    And the refusal is returned to the TypeScript caller
    And the TypeScript caller records a warning event through recordEvent

  # The invariant is "nothing sits between the check and the use". For a refused request
  # there is no "string that would have been used", so it is observed through what the
  # file system behind the boundary receives: nothing when refused, the identical string when allowed.
  Scenario: A refused path never reaches the file system, not even in a converted form
    Given the boundary sits in front of a file system that records every call it receives
    When the front end requests the JSON-encoded path "..\\..\\etc\\passwd" through the read command
    Then the request is refused
    And the file system behind the boundary received no call

  Scenario: An allowed path reaches the file system byte for byte
    Given the boundary sits in front of a file system that records every call it receives
    When the front end requests the JSON-encoded path "cards/a.md" through the read command
    Then the request succeeds
    And the file system behind the boundary received exactly one call
    And the string it received is byte-identical to "cards/a.md"

  Scenario: An allowed write reaches the file system byte for byte
    Given the boundary sits in front of a file system that records every call it receives
    When the front end writes to the JSON-encoded path "state/reviews.json" through the write command
    Then the request succeeds
    And the file system behind the boundary received exactly one call
    And the string it received is byte-identical to "state/reviews.json"

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
      | "raw/security/x.md"            |
      | "Raw/security/x.md"            |
      | "cards/%E1%84%80%E1%85%A1.md"  |

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
      | cards/console.md              |

  # Paths whose characters are outside plain ASCII are written as JSON unicode escapes (see the
  # encoding note above): U+AC00 is a composed Hangul syllable (category Lo), U+00E9 is e with acute
  # (Ll), and U+30FC (the last character of the katakana word) is the prolonged sound mark: category
  # Lm, so it is allowed even though its Script is Common.
  Scenario Outline: Paths in the allowed character set are allowed
    When the front end requests the JSON-encoded path <path> through the read command
    Then the request succeeds
    And the file system behind the boundary received exactly one call
    And the string it received is byte-identical to the decoded path

    Examples:
      | path                                                         |
      | "cards/Security.md"                                          |
      | "cards/\\uac00.md"                                           |
      | "cards/\\u00e9.md"                                           |
      | "cards/\\u30bb\\u30ad\\u30e5\\u30ea\\u30c6\\u30a3\\u30fc.md" |
      | "com0.md"                                                    |
      | "cards/console.md"                                           |
      | "cards/lpt0.txt"                                             |

  # The limit counts UTF-8 bytes of the whole relative path, not characters. 3-byte characters make
  # the two outlines differ: an implementation that counts characters would accept the second one.
  # Each path is "cards/", then <count> repetitions of <unit>, then ".md" (9 bytes of fixed text).
  Scenario Outline: A path of at most 240 UTF-8 bytes is allowed
    When the front end requests "cards/" followed by <count> repetitions of the JSON-encoded unit <unit> followed by ".md" through the read command
    Then the path is <bytes> UTF-8 bytes long
    And the request succeeds

    Examples:
      | unit        | count | bytes |
      | "a"         | 231   | 240   |
      | "\\uac00" | 77    | 240   |

  Scenario Outline: A path of more than 240 UTF-8 bytes is refused
    When the front end requests "cards/" followed by <count> repetitions of the JSON-encoded unit <unit> followed by ".md" through the read command
    Then the path is <bytes> UTF-8 bytes long
    And the request is refused
    And the refusal is returned to the TypeScript caller

    Examples:
      | unit        | count | bytes |
      | "a"         | 232   | 241   |
      | "\\uac00" | 78    | 243   |

  # The asset protocol decodes exactly once and then applies the same check to the decoded string.
  # Percent-encoded U+AC00 decodes to a composed (NFC) name and is allowed; the double-encoded forms
  # in the refusal table above still contain "%" after one decoding and are refused.
  Scenario: A percent-encoded allowed name is decoded exactly once by the asset protocol and then allowed
    When the web view requests the asset url for the JSON-encoded path "cards/%EA%B0%80.md" directly
    Then the string checked and used is "cards/\uac00.md"
    And the request succeeds

  # raw/ is not served (contract section 13, 1.3.1): it is the person's own material and is
  # read-only (section 12, hard rule 2), and its existence and names are not revealed either.
  # All five LearningFs methods refuse. assetUrl refuses because it is a read path: if it
  # did not, the web view could obtain a URL for a raw file and bypass the refusal of read.
  # This outline covers the four methods that are Rust commands, whose refusal travels back to
  # the TypeScript caller. assetUrl has a synchronous signature (it returns a string), so it is
  # its own scenario below: the refusal on that side is a hint, and the authority is the asset
  # protocol handler refusing when the web view actually requests the URL (the asset table above).
  # The first segment is compared with fixed ASCII case folding, because on a case-insensitive
  # file system Raw/ and raw/ are one directory.
  Scenario Outline: The raw directory is not served by the four command-backed LearningFs methods
    When the front end calls <operation> with the JSON-encoded path <path>
    Then the request is refused
    And the refusal is returned to the TypeScript caller
    And the TypeScript caller records a warning event through recordEvent
    And no file under raw is read, created or changed

    Examples:
      | operation | path |
      | read      | "raw/security/x.md" |
      | read      | "Raw/security/x.md" |
      | write     | "raw/security/x.md" |
      | write     | "RAW/security/x.md" |
      | exists    | "raw/security/x.md" |
      | list      | "raw" |
      | list      | "Raw/security" |

  Scenario: The raw directory is not served by assetUrl either
    Given the boundary sits in front of a file system that records every call it receives
    When the front end calls assetUrl with the JSON-encoded path "raw/security/x.md"
    Then the call is refused and returns no url
    And the file system behind the boundary received no call

  Scenario: Listing the root is refused
    When the front end lists the JSON-encoded directory ""
    Then the request is refused

  Scenario: A listing only returns names that would themselves pass the check
    Given a directory that contains a hidden entry ".hidden" and a file "ok.md"
    When the front end lists that directory
    Then the result is ["ok.md"]
    And no error is raised

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
