@i3 @data-layer @phase-4
Feature: The learning directory is its own git repository
  Contract §11b says the atomic write protects a single write from being torn in
  half. It does nothing about the other half of the problem: a write that lands
  correctly but writes the wrong thing, or a deletion nobody meant. Months of
  review history with no version to go back to is one bad command away from gone.
  So init turns the learning directory into its own git repository and a snapshot
  command commits the day's changes.

  Git is a recommendation in the contract, not a hard requirement, so a machine
  without git must still be able to use the whole product.

  Scenario: Initialising a learning directory also puts it under version control
    When the init command is run against an empty directory
    Then the learning directory is its own git repository
    And it has exactly one commit named init
    And a gitignore file is present

  Scenario: The first commit contains the state, graph and config files
    When the init command is run against an empty directory
    Then the first commit tracks reviews.json, weekly.json, deps.json and both config files
    And the working tree is clean

  Scenario: Assets are left out of version control
    Given an empty directory containing an image under assets
    When the init command is run against that directory
    Then the image is not tracked
    And the working tree is clean

  Scenario: Only the top level assets directory is excluded
    Given an initialised learning repository
    And a file under cards security assets
    When the snapshot command is run for that repository
    Then that file is tracked

  Scenario: Initialising twice does not re-initialise the repository
    Given an initialised learning repository
    When the init command is run again on it
    Then it still has exactly one commit named init
    And the commit it pointed at has not changed

  Scenario: Initialising twice does not overwrite an edited gitignore
    Given an initialised learning repository
    And the person has edited the gitignore
    When the init command is run again on it
    Then the edited gitignore is left alone

  Scenario: A learning directory inside another repository gets its own repository
    Given an empty directory nested inside another git repository
    When the init command is run against that directory
    Then the learning directory is its own git repository
    And the surrounding repository has no commits

  Scenario: Without git installed init warns and carries on
    Given a machine with no git available
    When the init command is run against an empty directory
    Then the directories raw, cards, questions, assets, state, graph and config exist
    And it warns that version control was skipped
    And it exits with status 0
    And the learning directory is not a git repository

  Scenario: Snapshotting commits the day's changes
    Given an initialised learning repository
    And a review was recorded today
    When the snapshot command is run for that repository
    Then a commit named snapshot with today's date is added
    And it exits with status 0

  Scenario: Snapshotting with nothing changed makes no commit
    Given an initialised learning repository
    When the snapshot command is run for that repository
    And the snapshot command is run for that repository again
    Then the number of commits is unchanged since before the first snapshot
    And it exits with status 0

  Scenario: Snapshotting a directory that is not a repository fails with guidance
    Given a learning directory that was never put under version control
    When the snapshot command is run for that repository
    Then it exits with status 1
    And it points the person at the init command

  Scenario: Snapshotting never commits into a surrounding repository
    Given a learning directory nested inside another git repository and never initialised
    When the snapshot command is run for that repository
    Then it exits with status 1
    And it points the person at the init command
    And the surrounding repository has no commits

  Scenario: Snapshotting a directory that does not exist fails
    Given a directory path that does not exist
    When the snapshot command is run for that repository
    Then it exits with status 1
    And it says the directory does not exist
