@wave0 @prompt-quality @phase-1 @standalone
Feature: A way to see when a prompt change makes things worse
  Prompts are the one part of this system that type checking and unit tests
  cannot protect. This phase builds the harness: fixed inputs, recorded outputs,
  side by side comparison, and structural checks that catch the mechanical
  failures without pretending to judge quality.

  In Wave 0 it runs against replayed fixtures, so it needs no model and no
  network.

  Background:
    Given a fake router replaying the recorded fixtures

  Scenario: The harness runs on its own
    When the standalone prompt check command is run in fake mode
    Then it exits with status 0
    And it reports how many golden inputs were processed

  Scenario: A golden run records every output
    Given a task with three golden inputs
    When a golden run is performed
    Then a dated directory is created for that task
    And it contains one output file per input
    And it contains the prompt file as it was at that moment

  Scenario: A golden run records what produced it
    When a golden run is performed
    Then the run records the model name, the provider and the date
    And it records the git commit of the prompt file

  Scenario Outline: Structural checks catch mechanical failures
    Given a recorded output where <problem>
    When the structural checks run
    Then the problem is reported

    Examples:
      | problem                                      |
      | a card body exceeds the word limit           |
      | the response is not valid JSON               |
      | a rubric has fewer than two criteria         |
      | a rubric has more than four criteria         |
      | the blank count does not match the answers   |
      | a required field is missing                  |

  Scenario: Structural checks do not judge quality
    Given a recorded output that is structurally perfect but says something wrong
    When the structural checks run
    Then no problem is reported
    And the run notes that quality requires human scoring

  Scenario: A scoring sheet is produced alongside the outputs
    When a golden run is performed
    Then a scoring file is written in the run directory
    And it lists each input with empty score fields
    And it names the two scoring dimensions

  Scenario: Comparing two runs shows each output side by side
    Given two golden runs exist for the same task
    When they are compared
    Then each input is shown with both outputs
    And differences are made visible without judging them
    And the scores from each run are shown if they were filled in

  Scenario: Comparing runs of different tasks is refused
    When a comparison is attempted across two different tasks
    Then it reports that the runs are not comparable

  Scenario: A missing golden set is reported clearly
    Given a task with no golden inputs defined
    When a golden run is attempted
    Then it reports that the task has no golden set
    And it names the file where the set should be defined

  Scenario: Fake mode never reaches the network
    When the command is run in fake mode
    Then no network request is made
    And the outputs come from the recorded fixtures
