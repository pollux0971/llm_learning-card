@integration @i3
Feature: Reviewing in a desktop window
  The same loop as I2, now in a window that sits on the desktop. The terminal
  path keeps working — it is the fallback and the debugging tool.

  Background:
    Given the desktop application is built for Linux
    And a learning directory populated by the I1 pipeline
    And 5 cards are due today

  @e2e @manual
  Scenario: A person completes a review session in the window
    When the person opens the test card window
    Then the header shows "Today 0 / 5"
    And the first question is displayed
    When the person answers all five questions
    Then the summary shows the pass and return counts
    And "state/reviews.json" on disk reflects every answer

  Scenario: The window and the terminal produce the same session
    Given a fixed learning directory and a fixed date
    When the question list is built in the window and in the terminal
    Then the two lists are identical in content and order

  Scenario: File access goes through the Tauri boundary
    When the window reads a card file
    Then it calls the read_learning_file command
    And the command rejects any path containing ".."
    And the command rejects any path outside the learning directory

  Scenario: Answers are written immediately
    Given the person has answered one question
    When the application is killed without a clean exit
    Then that answer is present in "state/reviews.json"

  Scenario: The window and the terminal see the same state
    Given the person answers two questions in the window
    When the person runs the review command in the terminal
    Then it shows the remaining three questions

  @manual
  Scenario: Window position survives a restart
    When the person moves and resizes both windows and quits
    And starts the application again
    Then both windows reappear at the same position and size

  @manual
  Scenario: Windows stay on top under X11
    Given the desktop session is X11
    When the person clicks another application
    Then both cards remain visible above it

  @manual
  Scenario: Wayland is detected and explained rather than hacked
    Given the desktop session is Wayland
    When the application starts for the first time
    Then it does not attempt to set always on top
    And it shows a one time note explaining how to configure this in the desktop environment

  @regression
  Scenario: The terminal review loop still works as in I2
    When the person runs the review command
    Then a full session can be completed as in I2
