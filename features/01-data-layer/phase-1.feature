@wave0 @data-layer @phase-1 @standalone
Feature: Schemas, card validation and the word counter
  This turns contracts/types.md into executable code. Every other module will
  eventually depend on it, but in Wave 0 it depends on nothing — it only reads
  the frozen contract and produces schemas, a validator and the shared fixtures.

  Background:
    Given the contract version is 1.0.0

  Scenario: The validator runs on its own
    When the standalone validate command is run against a valid fixture card
    Then it exits with status 0
    And it prints OK and the counted body length

  Scenario: Initialising a learning directory
    When the standalone init command is run against an empty directory
    Then the directories raw, cards, questions, assets, state, graph and config exist
    And reviews.json contains an empty object
    And weekly.json contains the current ISO week and a target
    And deps.json contains an empty object
    And categories.yaml contains an empty list
    And settings.yaml contains the default daily cap, weekly target and short body limit

  Scenario: Initialising twice does not overwrite
    Given a learning directory that already contains one review entry
    When the init command is run again
    Then that review entry is still present

  Scenario: A valid card passes
    Given a card with id, category, title, level, source and created
    And a body of 80 words
    When the validator runs
    Then the result is a pass

  Scenario Outline: A card missing a required field is rejected
    Given a card without the field <field>
    When the validator runs
    Then the result is a failure
    And the error mentions <field>

    Examples:
      | field    |
      | id       |
      | category |
      | title    |
      | level    |
      | source   |
      | created  |

  Scenario: A body over the limit is rejected
    Given a card whose body is 101 words
    When the validator runs
    Then the result is a failure
    And the error reports 101 against a limit of 100

  Scenario: A body exactly at the limit passes
    Given a card whose body is 100 words
    When the validator runs
    Then the result is a pass

  Scenario Outline: Word counting follows the contract
    Given a body containing <content>
    When the word counter runs
    Then the count is <count>

    Examples:
      | content                        | count | note                             |
      | TLS handshake needs 3 rounds.  | 5     | words and digits each count one  |
      | 同源政策                        | 4     | each CJK character counts        |
      | 同源政策(same-origin policy)   | 7     | the hyphen splits the sequence   |
      | a b c d e                      | 5     | five separate words              |
      | 一、二、三。                     | 3     | punctuation counts for nothing   |
      | TLS 1.3                        | 3     | the period splits the digits     |
      | don't                          | 2     | the apostrophe splits the word   |
      | RFC 6265                       | 2     | space separates two sequences    |
      |                                | 0     | empty                            |

  Scenario: Example fences are excluded from the count
    Given a card with a 60 word body
    And an example fence containing 500 words and an image
    When the validator runs
    Then the result is a pass
    And the reported body count is 60

  Scenario: A card may contain several example fences
    Given a card with three example fences
    When the validator runs
    Then the result is a pass
    And three example blocks are parsed

  Scenario: A card with no example fence is valid
    Given a card with a body and no example fence
    When the validator runs
    Then the result is a pass
    And zero example blocks are parsed

  Scenario: A card above level zero needs a parent
    Given a card at level 1 with no parent field
    When the validator runs
    Then the result is a failure
    And the error mentions that level 1 requires a parent

  Scenario: A raw sourced card needs a source reference
    Given a card whose source is raw with no source_ref field
    When the validator runs
    Then the result is a failure

  Scenario: An llm sourced card may omit the source reference
    Given a card whose source is llm with no source_ref field
    When the validator runs
    Then the result is a pass

  Scenario Outline: Card ids follow the contract pattern
    Given a card with id <id>
    When the validator runs
    Then the result is <result>

    Examples:
      | id       | result  |
      | sec-0042 | pass    |
      | lang-0001| pass    |
      | sec-42   | failure |
      | 0042     | failure |
      | SEC-0042 | failure |

  Scenario: The shipped fixtures validate as documented
    When the validator runs against every file under the cards fixture directory
    Then every file named valid passes
    And every file named invalid fails for the reason its filename states

  Scenario: The word count fixture matches the contract
    When the word counter runs against the word count fixture card
    Then the count is 23
