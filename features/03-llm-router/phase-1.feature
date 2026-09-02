@wave0 @llm-router @phase-1 @standalone
Feature: A single entry point for model calls
  Put every model call behind one door. After this, swapping models, swapping
  providers or adding a local model changes nothing for the callers.

  In Wave 0 only the cloud path exists; routing and the local model arrive in
  phase 2. This phase depends on nothing.

  Scenario: The probe runs on its own
    When the standalone probe command is run
    Then it exits with status 0
    And it prints whether the cloud is reachable
    And it makes no model call

  Scenario: Every call returns the same shape
    Given the provider is set to anthropic
    When a call is made for any task
    Then the result contains text, provider, model, latency and a provisional flag
    And the provisional flag is false

  Scenario Outline: The provider comes from the environment
    Given the configured provider is <provider>
    When a cloud call is made
    Then the <adapter> is used

    Examples:
      | provider  | adapter           |
      | anthropic | anthropic adapter |
      | openai    | openai adapter    |

  Scenario: An unknown provider fails immediately
    Given the configured provider is not one of the supported values
    When a cloud call is made
    Then an error naming the unsupported provider is raised
    And no network connection is attempted

  Scenario: A missing credential is reported plainly
    Given the provider is set to anthropic with no api key present
    When a cloud call is made
    Then an error naming the missing credential is raised
    And it does not silently fall back to anything else

  Scenario: The environment overrides the settings file
    Given the settings file names one model
    And the environment names a different one
    When a cloud call is made
    Then the model from the environment is used

  Scenario: Every call is logged
    When a call is made for the apply grading task
    Then a call event is appended to the log
    And it records the task, the provider, the model and the latency
    And it records token counts when the provider reports them

  Scenario: A call that exceeds the timeout is abandoned
    Given the provider does not respond within the timeout
    When a call is made
    Then a timeout error is raised
    And the log records the timeout

  Scenario: The timeout can be overridden per call
    Given a call specifies a shorter timeout
    When the provider does not respond within it
    Then the error is raised at the shorter deadline

  Scenario: Both adapters expose the identical shape
    When the same prompt is sent through each adapter
    Then the two results have the same set of fields

  Scenario: An unknown task name is rejected
    When a call is made with a task name that is not in the contract
    Then an error naming the unknown task is raised
    And no network connection is attempted

  @manual @llm
  Scenario: A real call to a real provider
    Given a valid credential
    When a short prompt is sent
    Then the returned text is meaningful
    And the latency is greater than zero
