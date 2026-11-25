@i5 @teach-card @phase-6
Feature: Ask the AI about the current card
  While reading a card the person can ask the AI a question about it. The AI
  answers, suggests what to do next and offers a few follow-up questions the
  person can pick to keep the discussion going.

  The suggestion is one of three: continue to the next card, go deeper into
  this card, or go back to the basics. It only highlights a control the teach
  card already has; it never moves on by itself (ADR-002, ADR-010, ADR-086).

  The discussion belongs to the card on screen. It is not written to disk and
  it is gone when the card changes or the window closes.

  Scenario: Asking a question shows the answer under the card
    Given the teach card shows a card
    And the AI answers "Because the list is sorted" and suggests continuing
    When the person asks "Why can we drop half of the list?"
    Then the answer "Because the list is sorted" is shown under the card
    And the card itself is unchanged

  Scenario: A suggestion to continue highlights next
    Given the teach card shows a card
    And the AI suggests continuing
    When the person asks a question
    Then the next button is highlighted
    And the teach card still shows the same card

  Scenario: A suggestion to go deeper highlights deepen
    Given the teach card shows a card
    And the AI suggests going deeper
    When the person asks a question
    Then the deepen button is highlighted
    And no deeper card is generated until the person presses it

  Scenario: A suggestion to go back points at an unlearned prerequisite
    Given the teach card shows a card with one unlearned prerequisite
    And the AI suggests going back to the basics
    When the person asks a question
    Then the prerequisite hint highlights that prerequisite

  Scenario: A suggestion to go back on a card without unlearned prerequisites
    Given the teach card shows a card whose prerequisites are all learned
    And the AI suggests going back to the basics
    When the person asks a question
    Then the answer says the AI suggests reviewing the basics
    And no control is highlighted

  Scenario: Follow-up options can be picked as the next question
    Given the teach card shows a card
    And the AI offers the follow-up questions "What if the list is not sorted?" and "How many steps does it take?"
    When the person asks a question
    And the person picks "How many steps does it take?"
    Then "How many steps does it take?" is sent as the next question
    And the earlier question and answer are part of what the AI is given

  Scenario: The discussion starts over on the next card
    Given the person has asked a question about the current card
    When the person presses next
    Then no earlier question or answer is shown
    And the next question does not include the earlier discussion

  Scenario: The discussion is not written to disk
    Given the teach card shows a card
    When the person asks a question and gets an answer
    Then the cards, the review state and the order file are unchanged

  Scenario: An answer the teach card cannot read shows a message
    Given the teach card shows a card
    And the AI returns text that is not a valid answer
    When the person asks a question
    Then the teach card says the answer could not be read and the person can ask again
    And no control is highlighted

  Scenario: Without any model the person is told and the card still works
    Given the computer is offline and no local model is available
    When the person asks a question
    Then the teach card says no AI is available right now
    And the next button still works

  Scenario: An answer from the local model is marked provisional
    Given the computer is offline and a local model is available
    When the person asks a question
    Then the answer is marked as provisional

  Scenario: The daily spending cap stops the question before the call
    Given today's LLM spending has reached the daily cap
    When the person asks a question
    Then the teach card says today's AI budget is used up
    And no AI call is made

  @manual
  Scenario: The discussion fits the HUD layout
    Given the person has asked two questions about a long card
    When the answers and follow-up options are shown
    Then they scroll with the card content and do not cover the controls
    And the highlighted control is easy to see but not loud
    And everything stays readable at the minimum window size and at every zoom step
