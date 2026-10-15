@i3 @desktop-shell @phase-2
Feature: The file boundary and the learning directory
  The front end never touches the file system directly. Everything goes through
  a narrow interface that refuses anything outside the learning directory.

  This is a security boundary, so unlike the rest of this folder it is tested
  automatically and thoroughly.

  # Where the learning directory is (ADR-066, ADR-069; contract section 12, version 1.4.0).
  # There is exactly one source: the user-level pointer file written by "npx tsx scripts/vault.ts init".
  # The desktop application only reads it. It never writes the pointer file or the identity marker
  # config/vault-id, because those carry money and identity and a second writer would be a second
  # place to disagree. The start state is one of five and the four failures are never mixed:
  #   pointer-missing, pointer-unreadable, learning-dir-missing, marker-mismatch, ok.
  # The names are the reasons used by the shared file contracts/fixtures/vault-pointer-vectors.json.
  # The pointer path is ${XDG_CONFIG_HOME:-~/.config}/llm-learning-cards/vault.json (an empty
  # XDG_CONFIG_HOME counts as unset). It is not the Tauri application config directory.

  Scenario: First run without a pointer file shows how to set up and writes nothing
    Given the user-level pointer file does not exist
    When the application starts
    Then the start state is pointer-missing
    And the screen says the learning directory is not set up yet
    And the screen shows the full command "npx tsx scripts/vault.ts init --learning-dir" followed by a path placeholder
    And the application wrote no file anywhere

  Scenario: A directory named by an environment variable is not a second source
    Given the user-level pointer file does not exist
    And the environment variable LC_LEARNING_ROOT names an existing directory
    When the application starts
    Then the start state is pointer-missing

  Scenario Outline: A pointer file that cannot be read is reported with its path and is never overwritten
    Given the user-level pointer file exists but <problem>
    When the application starts
    Then the start state is pointer-unreadable
    And the screen says the settings file cannot be read
    And the screen shows the absolute path of the pointer file
    And the pointer file is byte-identical to before
    And the application wrote no file anywhere

    Examples:
      | problem                                   |
      | it is not valid JSON                      |
      | reading it fails with a permission error  |
      | a field has the wrong type                |
      | learning_dir is a relative path           |

  Scenario: A configured path that no longer exists is reported
    Given the pointer file names a learning directory that does not exist
    When the application starts
    Then the start state is learning-dir-missing
    And the screen says the folder could not be found
    And the screen shows that path and the full init command
    And the application wrote no file anywhere

  Scenario Outline: A directory that is not the one the pointer was made for is not opened
    Given the pointer file names an existing learning directory
    And the identity marker of that directory <marker>
    When the application starts
    Then the start state is marker-mismatch
    And the screen says this is not the same folder
    And neither the pointer file nor the marker is changed
    And the application wrote no file anywhere

    Examples:
      | marker                                       |
      | holds a different identity                   |
      | does not exist                               |
      | cannot be read                               |
      | matches only in its first 8 characters       |
      | has two trailing newlines                    |

  Scenario: A matching identity opens both windows
    Given the pointer file names an existing learning directory
    And the identity marker of that directory matches the pointer file
    When the application starts
    Then the start state is ok
    And the teach card window and the test card window are opened
    And the application wrote no file anywhere

  # The commands and the asset protocol must use one resolved result, not each read the pointer file.
  Scenario: The commands and the asset protocol share one resolved learning directory
    Given the start state is ok
    When the front end reads a card through the read command and the web view requests the same card through the asset protocol
    Then both were served from the same learning directory
    And the pointer file was read once for the whole run

  Scenario Outline: In a failed start state the commands report not configured and the asset protocol refuses
    Given the start state is <state>
    When the front end calls the <command> command with a legal relative path
    Then the call fails with the not-configured error
    And the error is neither a refusal nor an io error
    And the learning log gets no new line
    And the asset protocol answers 403 for the same path

    Examples:
      | state                | command |
      | pointer-missing      | read    |
      | pointer-unreadable   | write   |
      | learning-dir-missing | list    |
      | marker-mismatch      | exists  |

  # The Rust resolver and the TypeScript resolver (packages/core/src/llm/ledger.ts, used by the money
  # scripts) read the same vectors, so the two cannot drift. Rows are the file's own; none may be
  # added or skipped on the Rust side.
  Scenario: The Rust pointer path rule agrees with every shared vector
    When the Rust resolver computes the pointer path for every row of the pointer_path vectors
    Then each result equals the expected path of its row
    And the rows cover XDG_CONFIG_HOME set, unset and the empty string

  Scenario: The Rust identity comparison agrees with every shared vector
    When the Rust resolver compares the marker text and the vault id of every row of the marker_compare vectors
    Then each result is equal or not-equal exactly as its row says

  Scenario: The Rust pointer parser agrees with every shared vector
    When the Rust resolver parses the raw content of every row of the pointer_content vectors
    Then each result is ok with the row's learning_dir and vault_id, or unreadable, exactly as its row says

  Scenario: The Rust start state agrees with every shared state vector
    When the Rust resolver runs every row of the states vectors in a temporary directory
    Then each start state equals the expected reason of its row
    And the vectors file has 47 rows in total and its sha256 is the pinned value

  Scenario: The pointer file is looked up where the command line tools look
    Given XDG_CONFIG_HOME names a temporary directory containing a valid pointer file
    When the application starts
    Then the start state is ok
    And the pointer file was not looked up under the Tauri application config directory

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
  #
  # Escape rule, measured with @cucumber/gherkin: step text is NOT backslash-decoded, a table
  # cell is. So a JSON string written in a step needs ONE backslash (for example \u00e9),
  # and the same JSON string written in a table cell needs TWO backslashes (\\u00e9).

  Scenario Outline: Paths that are not clean relative paths are refused through the read command
    When the front end requests the JSON-encoded path <path> through the read command
    Then the request is refused
    And the refusal is returned to the TypeScript caller
    And the Rust side appends one warning event line to the learning log
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
    And the Rust side appends one warning event line to the learning log

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

  # ADR-069 (2026-10-15) replaces the 2026-10-01 known limitation: the web view has no node:fs,
  # so the Rust side writes the section 10 warning events itself, for the commands and for the
  # asset protocol. A refusal on the asset protocol path has no TypeScript caller, so there it is
  # rate limited (see the limiter scenarios below). Every line written passes LogEventSchema.
  Scenario Outline: Paths that escape through the asset protocol are refused without going through the read command
    Given the asset refusal limiter has no earlier refusals
    When the web view requests the asset url for the JSON-encoded path <path> directly
    Then the request is refused
    And the Rust side appends one warning event line to the learning log
    And the warning line passes the LogEventSchema check

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

  # Rate limit: at most one line per refusal reason per 60 seconds. The line carries a count field
  # = how many refusals of that reason happened since the previous line for that reason, this one
  # included. The path in the line is the path of the refusal that triggered the write. The clock is injected.
  Scenario: Repeated asset refusals of one reason write one line per 60 seconds with a count
    Given the asset refusal limiter has no earlier refusals
    When the web view is refused with reason structure at seconds 0, 10, 20 and 61
    And the web view is refused with reason raw at second 5
    Then the learning log gets exactly three warning lines
    And the structure line written at second 0 has count 1
    And the raw line written at second 5 has count 1
    And the structure line written at second 61 has count 3
    And every written line passes the LogEventSchema check

  Scenario: Refusals not yet written are flushed as one last line when the application ends normally
    Given the asset refusal limiter has no earlier refusals
    When the web view is refused with reason structure at seconds 0, 10 and 20
    And the application ends normally at second 30
    Then the learning log gets exactly two warning lines
    And the last line has count 2

  # Boundary: a line is written when at least 60 seconds have passed since the previous line for that
  # reason (greater than or equal, not greater than). Both implementations must use the same comparison.
  Scenario: A refusal exactly 60 seconds after the last written line is written
    Given the asset refusal limiter has no earlier refusals
    When the web view is refused with reason structure at seconds 0 and 60
    Then the learning log gets exactly two warning lines
    And the structure line written at second 60 has count 1

  Scenario: A refusal 59 seconds after the last written line is not written
    Given the asset refusal limiter has no earlier refusals
    When the web view is refused with reason structure at seconds 0 and 59
    Then the learning log gets exactly one warning line

  # Refusals on the four commands are not rate limited: each one is a person's own action
  # and has a caller that sees the refusal.
  Scenario: Refusals through the commands are never rate limited
    When the front end requests the JSON-encoded path "raw/x.md" through the read command 3 times
    Then the learning log gets exactly three warning lines

  Scenario: A warning line is one write of one complete line
    When the front end requests the JSON-encoded path "raw/x.md" through the read command
    Then the Rust side wrote the line with exactly one write call
    And the line ends with a newline
    And the line was flushed to disk before the command returned

  Scenario: A path with a NUL character is written as one line with the NUL escaped
    When the front end requests the path "cards/a.md", then a NUL character, then ".png" through the read command
    Then the learning log gets exactly one warning line
    And the line parses as JSON
    And the path in the parsed line is byte-identical to the requested path

  Scenario: The TypeScript and the Rust warning events have the same shape
    When the same refused path is recorded by the TypeScript recordEvent and by the Rust side
    Then after removing ts and the Rust-only fields op, check and count the two parsed events are deeply equal

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
    And the Rust side appends one warning event line to the learning log
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

  # ADR-069. A refusal (the whitelist or a symlink check said no) writes a warning event.
  # An io error (the path is legal but the file system failed) does not: it is not an attack,
  # and the TypeScript caller must be able to tell the two apart, by the error class it receives.
  Scenario Outline: A read that fails in the file system is an io error, not a refusal
    Given the learning directory is in the state: <state>
    When the front end requests the JSON-encoded path <path> through the read command
    Then the request fails with an io error whose code is <code>
    And the error is not a refusal
    And the learning log has no new line

    Examples:
      | state                                  | path           | code       |
      | no such file                           | "cards/missing.md" | not_found  |
      | the path is a directory                | "cards"        | is_dir     |
      | the file is not readable by the caller | "cards/locked.md" | permission |
      | the file is not valid UTF-8            | "cards/bad.md" | not_utf8   |

  Scenario: A refusal is not an io error
    When the front end requests the JSON-encoded path "raw/x.md" through the read command
    Then the request is refused
    And the error is not an io error
    And the learning log gets exactly one warning line

  Scenario: Asking whether a legal missing path exists is not an error
    When the front end asks whether the JSON-encoded path "cards/missing.md" exists
    Then the answer is false
    And the learning log has no new line

  Scenario: Listing a directory that does not exist is an io error
    When the front end lists the JSON-encoded directory "cards/nope"
    Then the request fails with an io error whose code is not_found
    And the learning log has no new line

  Scenario: A listing skips an entry whose metadata cannot be read
    Given a directory with the files "ok.md" and one entry whose metadata cannot be read
    When the front end lists that directory
    Then the result is ["ok.md"]
    And no error is raised

  Scenario: A write to a dangling symbolic link is refused and creates nothing outside
    Given a symbolic link "cards/evil.md" inside the learning directory points to a path outside it that does not exist
    When the front end writes to the JSON-encoded path "cards/evil.md" through the write command
    Then the request is refused
    And nothing was created at the target outside the learning directory

  # The Rust write command uses one atomic write for every path under the learning directory
  # (contract section 11b: write a temporary file, fsync it, rename it, fsync the directory).
  # The vectors are the shared file packages/core/src/schema/atomic-write.vectors.json that the
  # TypeScript atomic write also runs. Rust may not skip or add a row.
  Scenario: Every row of the shared atomic write vectors behaves the same in Rust
    When the Rust atomic write runs every row of the shared atomic write vectors
    Then every row has the same injected failure and the same expected outcome as in TypeScript
    And Rust did not add or skip any row

  Scenario Outline: A write outside state also goes through the atomic write
    When the front end writes to the JSON-encoded path <path> through the write command
    Then the Rust atomic write is used
    And the target holds the new content and no temporary file is left

    Examples:
      | path                |
      | "state/reviews.json" |
      | "cards/a.md"        |
      | "questions/a.yaml"  |

  Scenario Outline: A failed fsync of the directory is told apart from an unsupported one
    When the directory fsync reports <errno>
    Then the write <outcome>
    And the target holds the new content

    Examples:
      | errno  | outcome                          |
      | EINVAL | succeeds and leaves no temporary file |
      | EIO    | fails with that error            |
      | ENOSPC | fails with that error            |

  # Contract 1.4.0 section 13 and ADR-067. The Rust path check and the TypeScript CategoryId check
  # load the same file, contracts/fixtures/path-segment-vectors.json. Rows are chosen by their
  # applies_to list, never by the rule field.
  Scenario: The Rust segment check agrees with every shared segment vector
    When the Rust segment check runs every row of the shared segment vectors whose applies_to has segment
    Then each row is accepted or refused exactly as its expect says
    And the rows whose applies_to does not have segment are ignored and counted
    And the file has 51 rows, 47 of them for segment, and its sha256 is the pinned value

  Scenario: A 64 byte limit is not applied to path segments
    When the front end requests a path with one segment of 234 bytes through the read command
    Then the request is not refused

  # Images are bytes. The asset protocol reads bytes, sets the content type from the extension
  # and always says nosniff. SVG can carry script, so it is also given a content security policy
  # that forbids script.
  Scenario: An image comes back byte for byte
    Given the file "assets/x.png" holds a PNG header followed by bytes including 00 and FF
    When the web view requests the asset url for the JSON-encoded path "assets/x.png" directly
    Then the response status is 200
    And the sha256 of the response body equals the sha256 of the file
    And the content type is image/png
    And the response has the header X-Content-Type-Options set to nosniff

  Scenario Outline: The content type follows the extension
    Given a file with the extension <extension> under assets
    When the web view requests the asset url for that file directly
    Then the content type is <type>
    And the response has the header X-Content-Type-Options set to nosniff

    Examples:
      | extension | type                     |
      | jpg       | image/jpeg               |
      | jpeg      | image/jpeg               |
      | gif       | image/gif                |
      | webp      | image/webp               |
      | svg       | image/svg+xml            |
      | bin       | application/octet-stream |

  Scenario: An SVG response forbids script
    Given the file "assets/x.svg" exists
    When the web view requests the asset url for the JSON-encoded path "assets/x.svg" directly
    Then the response has the header Content-Security-Policy set to "script-src 'none'"

  Scenario: A missing asset is a 404 and writes no warning
    When the web view requests the asset url for the JSON-encoded path "assets/missing.png" directly
    Then the response status is 404
    And the learning log has no new line

  Scenario: A refused asset is a 403
    When the web view requests the asset url for the JSON-encoded path "raw/x.png" directly
    Then the response status is 403
    And the Rust side appends one warning event line to the learning log

  Scenario: The application sets a content security policy
    Given the application configuration
    Then the content security policy is a string and not null
    And it contains the directives default-src, script-src, object-src, frame-src and img-src
    And script-src does not allow unsafe-inline or unsafe-eval

  # The web view side is TypeScript that runs in a browser engine, so it has no node: modules.
  Scenario: The web view file system adapter imports nothing from node
    When the files of the web view LearningFs and everything it imports are scanned
    Then none of them imports a node: module
    And none of them imports the schema log module

  Scenario: The real front ends are loaded
    When the application is built
    Then the teach card and test card windows each point to an html file inside the built front end folder
    And every script and link in those html files resolves to a file that exists in that folder
    And no referenced file ends in .ts
    And no placeholder content remains

  Scenario: A page that references TypeScript source directly fails the static check
    Given a built front end folder whose html references a .ts source file
    When the static front end check runs
    Then the check fails and names the file
