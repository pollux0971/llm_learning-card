@i2 @prompt-quality @phase-2
Feature: Golden runs against a real model
  Now that real prompts exist, establish the baseline and make regression
  visible. The judging is done by a person; the tool's job is to make the
  comparison easy enough that the person actually does it.

  Scenario: A live golden run uses the configured cloud model
    Given the network is available
    When a golden run is performed in live mode
    Then the real router is used with the cloud provider
    And each call is recorded in the log
    And the run reports the estimated token cost

  Scenario: Live mode refuses when offline
    Given the network is unavailable
    When a golden run is attempted in live mode
    Then it reports that a live run needs the cloud
    And no directory is created

  Scenario: The baseline is established once and kept
    Given no previous golden run exists for a task
    When a live golden run is performed and scored
    Then that run is marked as the baseline
    And later runs are compared against it by default

  Scenario: A prompt change without a golden run is detectable
    Given a prompt file has changed since the last golden run
    When the check command is run
    Then it reports that the prompt has changed without a new baseline
    And it names the prompt file and both commits

  Scenario: Scores are carried forward for unchanged outputs
    Given a new run produces an identical output for one input
    When the comparison runs
    Then that input's previous score is carried forward
    And it is marked as unchanged rather than needing rescoring

  Scenario: The comparison highlights what needs a person's eyes
    Given a new run differs on two of three inputs
    When the comparison runs
    Then those two are listed as needing scoring
    And the unchanged one is listed separately

  @manual
  Scenario: A deliberately worse prompt is visibly worse
    Given the ingest prompt is edited to remove the instruction about one concept per card
    When a live golden run is performed and compared to the baseline
    Then the outputs visibly cover several concepts per card
    And the scoring sheet makes it easy to record that regression
