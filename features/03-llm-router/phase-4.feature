@llm-router @phase-4
Feature: The gateway local adapter and the daily budget fallback
  The local model lives on another machine, behind a JWT gateway (ADR-039). It
  reports itself as the ollama provider, so it is the local column of the
  contract's routing table without changing the contract. Because it is free,
  it is also the brake on cloud spending: when OpenAI fails or the day's budget
  is gone, deepening, applied grading and short reteaching move over to it and
  are marked provisional. Card generation never does — a card is read for
  months, and the local model has not been graded on that job yet.

  Background:
    Given the gateway is configured with a base url, a key and a local model name

  # ------------------------------------------------------------------ 1. probe

  Scenario: The gateway reports the models it can serve
    Given the gateway exchanges the key for a token and lists two models
    When the gateway probe runs
    Then the gateway reports itself as available
    And the returned model list names both of them

  Scenario: A wrong key is not an error, just unavailable
    Given the gateway rejects the key exchange with 401
    When the gateway probe runs
    Then the gateway reports itself as unavailable
    And the probe raises no error

  Scenario: An unreachable gateway is not an error either
    Given the gateway machine refuses the connection
    When the gateway probe runs
    Then the gateway reports itself as unavailable
    And the probe raises no error

  # ------------------------------------------------------------------ 2. chat

  Scenario: Fill grading always goes to the gateway
    Given the gateway is running
    When a routed call is made for the fill grading task
    Then the result names the ollama provider
    And the result names the configured local model
    And the result does not carry the provisional flag

  # -------------------------------------------------------------- 3. fallback

  Scenario: Applied grading falls back to the gateway when the cloud fails
    Given the gateway is running
    And the cloud provider answers 503
    When a routed call is made for the apply grading task
    Then the result comes from the gateway
    And the result carries the provisional flag
    And the log records the gateway fallback and that the cloud call failed

  Scenario: Card generation refuses to fall back
    Given the gateway is running
    And the cloud provider answers 503
    When a routed call is made for the card generation task
    Then the cloud required error is raised
    And the gateway is never called

  # ---------------------------------------------------------------- 4. budget

  Scenario: Deepening moves to the gateway once the day's budget is gone
    Given the gateway is running
    And today's log already spends the whole daily cap
    When a routed call is made for the deepen task
    Then the result comes from the gateway
    And the result carries the provisional flag
    And the log records the gateway fallback and that the budget was exhausted
    And no cloud call is made

  Scenario: Card generation is refused before it spends anything
    Given the gateway is running
    And today's log already spends the whole daily cap
    When a routed call is made for the card generation task
    Then it is refused with the daily budget message
    And no cloud call is made
    And the gateway is never called

  Scenario: Spending exactly the cap counts as exhausted
    Given today's log spends exactly the daily cap and not a cent more
    When the budget is checked
    Then the budget counts as exhausted

  Scenario: Yesterday's spending does not count against today
    Given yesterday's log spends twice the daily cap
    And today's log spends nothing
    When the budget is checked
    Then the budget does not count as exhausted

  Scenario: Gateway calls are free and never count against the budget
    Given today's log holds only gateway calls with large token counts
    When the budget is checked
    Then the budget does not count as exhausted

  # ------------------------------------------------------------------- 5. 403

  Scenario: A cloud model name is rejected outright
    Given the gateway answers 403 because the requested model is not a local one
    When a routed call is made for the fill grading task
    Then an error naming the rejected model is raised
    And it does not fall back to the cloud

  # ------------------------------------------------------- 6. token expiry

  Scenario: A valid token is reused instead of exchanged again
    Given the gateway is running
    When two gateway calls are made inside the token lifetime
    Then the key is exchanged for a token only once

  Scenario: An expired token is exchanged again and the call is retried
    Given the gateway is running
    And the cached token has expired
    When a routed call is made for the fill grading task
    Then the key is exchanged for a token twice
    And the call succeeds

  # ---------------------------------------------------------------- 7. manual

  @manual
  Scenario: The real gateway answers the probe command
    Given the real gateway is running and the key is in the env file
    When the standalone probe command is run against the real gateway
    Then it prints the list of models the gateway serves
