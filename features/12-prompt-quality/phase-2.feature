@i2 @prompt-quality @phase-2
Feature: Golden runs against a real model
  Now that real prompts exist, establish the baseline and make regression
  visible. The judging is done by a person; the tool's job is to make the
  comparison easy enough that the person actually does it.

  The person still scores two dimensions and only two. Everything the machine
  can decide without judging quality — word counts, valid JSON, rubric sizes,
  and now duplicate rate and graph shape — is a structural check, so it never
  becomes a third box for a human to fill in.

  # ------------------------------------------------------------ live golden run

  Scenario: A live golden run uses the configured cloud model
    Given the cloud is reachable
    When a golden run is performed in live mode
    Then the real router is used with the cloud provider
    And each call is recorded in the log
    And the run reports the estimated token cost

  Scenario: The estimate is omitted rather than guessed
    Given the cloud is reachable
    And the configured model is not in the price table
    When a golden run is performed in live mode
    Then the run reports the token counts
    And it reports no cost estimate

  Scenario: Live mode refuses when offline
    Given the cloud is not reachable
    When a golden run is attempted in live mode
    Then it reports that a live run needs the cloud
    And no directory is created

  Scenario: Live mode still runs the structural checks
    Given the cloud is reachable
    When a golden run is performed in live mode
    Then the structural checks run on every output
    And it notes that quality still requires human scoring

  # ------------------------------------------------- duplicate rate (structural)

  Scenario: Cards that repeat each other in the same batch are counted
    Given a batch where four pairs of cards repeat each other
    When the batch checks run
    Then the duplicate rate is reported as pairs over cards
    And each duplicate pair is listed by id

  Scenario: A batch with nothing repeated reports zero
    Given a batch where no two cards repeat each other
    When the batch checks run
    Then the duplicate rate is zero
    And no pair is listed

  Scenario: Titles are compared after normalising case and spacing
    Given two cards whose titles differ only in case, spacing and punctuation
    When the batch checks run
    Then they are counted as one duplicate pair

  Scenario Outline: The similarity threshold is inclusive at the boundary
    Given two cards whose body similarity is <similarity>
    When the batch checks run
    Then the pair is <verdict>

    Examples:
      | similarity          | verdict     |
      | exactly at the threshold | counted     |
      | just below the threshold | not counted |

  Scenario: The real I1 batch is the recorded baseline
    Given the twenty five cards from the I1 run
    When the batch checks run
    Then the duplicate rate is zero at the current threshold
    And the count is recorded in the scoring sheet

  # -------------------------------------------------- graph shape (structural)

  Scenario: A level 0 card that depends on a level 1 card is listed
    Given a level 0 card whose prereqs contain a level 1 card
    When the batch checks run
    Then that prereq is listed as a graph shape problem

  Scenario: A level 1 card depending on a level 0 card is not a problem
    Given a level 1 card whose prereqs contain a level 0 card
    When the batch checks run
    Then no graph shape problem is reported

  Scenario: The real I1 batch has four of them
    Given the twenty five cards from the I1 run
    When the batch checks run
    Then four graph shape problems are listed
    And the count is recorded in the scoring sheet

  # ------------------------------------------------------------- scoring sheet

  Scenario: The scoring sheet asks a person for two dimensions and no more
    Given the cloud is reachable
    When a golden run is performed in live mode
    Then the scoring sheet lists exactly two dimensions for the person
    And the machine checks are reported in a separate section
    And that section is present even when both counts are zero

  # ---------------------------------------------------------- regression flow

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

  # --------------------------------------------- the registration gate itself

  # This gate is the reason phase 2 was sent back once: the framework shipped
  # green while registering only the Wave 0 demo, so none of the real ingest
  # prompts had a baseline. Zero references means nothing is guarded; two
  # references means one of the sets is scoring somebody else's prompt. Both
  # have to be red, and so does a scanner that finds nothing at all.

  Scenario: Every real ingest prompt file has a golden set
    When the registration gate runs
    Then the gate passes
    And each of the five ingest prompt files is named by exactly one golden set

  Scenario: A prompt file nobody registered is reported
    Given a prompt file that no golden set names
    When the registration gate runs
    Then the gate fails
    And it names that file as unregistered

  Scenario: A prompt file two golden sets both claim is reported
    Given two golden sets that name the same prompt file
    When the registration gate runs
    Then the gate fails
    And it names that file and both sets

  Scenario: Finding no prompt files at all is a broken scanner, not a clean run
    Given the prompt directory holds no prompt files
    When the registration gate runs
    Then the gate fails
    And it says the scanner is broken rather than reporting everything is fine

  # ------------------------------------------------------------------- manual

  @manual @llm
  Scenario: A deliberately worse prompt is visibly worse
    Given the ingest prompt is edited to remove the instruction about one concept per card
    When a live golden run is performed and compared to the baseline
    Then the outputs visibly cover several concepts per card
    And the scoring sheet makes it easy to record that regression

  @manual @llm
  Scenario: The first real baseline is recorded against the cloud model
    Given the cloud credentials are configured and spending is approved
    When a live golden run is performed for the ingest tasks
    Then the outputs are stored under the golden directory
    And the duplicate rate and graph shape counts are recorded next to the person's scores
